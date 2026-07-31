import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import {
  createEvolutionInstance,
  getEvolutionConnectionState,
  setEvolutionWebhook,
  EVOLUTION_WEBHOOK_EVENTS,
} from '@/lib/whatsapp/evolution-api'

/**
 * GET /api/whatsapp/evolution-config
 *
 * Returns the saved Evolution config (masked) plus a live connection-
 * state probe, mirroring GET /api/whatsapp/config's shape for the Meta
 * provider. 200 in every non-auth case so the UI can render a specific
 * message instead of a generic error toast.
 */
export async function GET() {
  let ctx
  try {
    ctx = await requireRole('admin')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { supabase, accountId } = ctx

  const { data: config, error } = await supabase
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('api_type', 'evolution')
    .maybeSingle()

  if (error) {
    console.error('[evolution-config GET] fetch error:', error)
    return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 })
  }
  if (!config) {
    return NextResponse.json({ configured: false })
  }

  // Best-effort — a failed probe still returns the saved config so the
  // form can render, just with an 'unknown' connection state.
  let state = 'unknown'
  try {
    const apiKey = decrypt(config.api_key)
    const result = await getEvolutionConnectionState({
      apiUrl: config.api_url,
      apiKey,
      instanceName: config.instance_name,
    })
    state = result.state
  } catch (err) {
    console.error('[evolution-config GET] connection state check failed:', err)
  }

  // VERIFY AGAINST A REAL INSTANCE: 'open' is the Baileys convention
  // for "connected" — see the VERIFY comment on EvolutionConnectionState
  // in evolution-api.ts.
  const connected = state === 'open'
  const newStatus = connected ? 'connected' : 'disconnected'

  // Self-heal `status`: unlike the Meta config route, nothing else ever
  // writes this column for an Evolution row after the initial save (it
  // starts at 'disconnected' and would otherwise stay there forever).
  // Other surfaces — the inbox's connection banner — read this column
  // directly rather than probing live, so it needs to track reality.
  // Skipped when the probe itself failed ('unknown'): don't overwrite a
  // real status with a guess based on a network hiccup.
  if (state !== 'unknown' && config.status !== newStatus) {
    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update({ status: newStatus })
      .eq('id', config.id)
    if (updateError) {
      console.error('[evolution-config GET] status self-heal failed:', updateError)
    }
  }

  return NextResponse.json({
    configured: true,
    instance_name: config.instance_name,
    api_url: config.api_url,
    is_primary: config.is_primary,
    status: state === 'unknown' ? config.status : newStatus,
    connection_state: state,
    connected,
  })
}

/**
 * POST /api/whatsapp/evolution-config
 *
 * Saves Evolution credentials, creates (or confirms) the instance, and
 * registers our inbound webhook — all three in one call so the
 * Settings UI can go straight from "filled in the form" to "ready to
 * show a QR code" without a separate wiring step.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json()
    const { instance_name, api_url, api_key } = body as {
      instance_name?: string
      api_url?: string
      api_key?: string
    }

    if (!instance_name?.trim() || !api_url?.trim() || !api_key?.trim()) {
      return NextResponse.json(
        { error: 'instance_name, api_url, and api_key are all required' },
        { status: 400 },
      )
    }
    const apiUrl = api_url.trim().replace(/\/+$/, '')
    const instanceName = instance_name.trim()
    const apiKey = api_key.trim()

    // Verify the credentials work before saving anything — instance
    // creation is the cheapest call that exercises auth + reachability
    // together, and createEvolutionInstance() already treats "instance
    // already exists" as success so re-saving is safe.
    try {
      await createEvolutionInstance({ apiUrl, apiKey, instanceName })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return NextResponse.json(
        { error: `Could not reach Evolution API: ${message}` },
        { status: 400 },
      )
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, webhook_secret')
      .eq('account_id', accountId)
      .eq('api_type', 'evolution')
      .maybeSingle()

    // Reuse the existing webhook_secret on re-save so a webhook URL
    // already registered with Evolution (which embeds it) doesn't
    // silently stop authenticating.
    const webhookSecret = existing?.webhook_secret
      ? decrypt(existing.webhook_secret)
      : crypto.randomBytes(24).toString('hex')

    const row = {
      account_id: accountId,
      user_id: userId,
      api_type: 'evolution' as const,
      instance_name: instanceName,
      api_url: apiUrl,
      api_key: encrypt(apiKey),
      webhook_secret: encrypt(webhookSecret),
      status: 'disconnected',
      updated_at: new Date().toISOString(),
    }

    let configId: string
    if (existing) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(row)
        .eq('id', existing.id)
      if (updateError) {
        console.error('[evolution-config POST] update error:', updateError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
      configId = existing.id
    } else {
      // is_primary explicitly false on insert: the column default
      // (migration 048) is `true`, meant for a fresh Meta row on an
      // account with nothing configured yet — an Evolution row should
      // never silently become primary and redirect 1:1 traffic away
      // from an already-working Meta setup.
      const { data: inserted, error: insertError } = await supabase
        .from('whatsapp_config')
        .insert({ ...row, is_primary: false })
        .select('id')
        .single()
      if (insertError || !inserted) {
        console.error('[evolution-config POST] insert error:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
      configId = inserted.id
    }

    const webhookUrl = `${new URL(request.url).origin}/api/whatsapp/evolution-webhook/${configId}?secret=${webhookSecret}`
    try {
      await setEvolutionWebhook({
        apiUrl,
        apiKey,
        instanceName,
        webhookUrl,
        events: [...EVOLUTION_WEBHOOK_EVENTS],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      // Credentials + instance are saved; only webhook registration
      // failed. Surface this distinctly so the UI doesn't claim full
      // success — inbound messages won't arrive until this is retried.
      return NextResponse.json({
        success: true,
        saved: true,
        webhook_registered: false,
        webhook_error: message,
      })
    }

    return NextResponse.json({ success: true, saved: true, webhook_registered: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/whatsapp/evolution-config
 *
 * Body: { is_primary: boolean } — toggles whether 1:1 sends route
 * through Evolution instead of Meta (see resolveProviderConfig).
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json()
    const isPrimary = (body as { is_primary?: unknown })?.is_primary
    if (typeof isPrimary !== 'boolean') {
      return NextResponse.json({ error: 'is_primary (boolean) is required' }, { status: 400 })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .eq('api_type', 'evolution')
      .maybeSingle()
    if (!config) {
      return NextResponse.json({ error: 'Evolution API not configured' }, { status: 400 })
    }

    if (isPrimary) {
      // The partial unique index (migration 048) allows only one
      // is_primary=true row per account — unset every row first so the
      // subsequent set never races the constraint.
      const { error: clearError } = await supabase
        .from('whatsapp_config')
        .update({ is_primary: false })
        .eq('account_id', accountId)
      if (clearError) {
        console.error('[evolution-config PATCH] clear error:', clearError)
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
      }
    }

    const { error: setError } = await supabase
      .from('whatsapp_config')
      .update({ is_primary: isPrimary })
      .eq('id', config.id)
    if (setError) {
      console.error('[evolution-config PATCH] set error:', setError)
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/whatsapp/evolution-config
 *
 * Removes the account's Evolution config row so the operator can
 * re-enter credentials from scratch. Scoped to api_type='evolution' —
 * must never touch a sibling Meta row.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)
      .eq('api_type', 'evolution')
    if (error) {
      console.error('[evolution-config DELETE] error:', error)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
