import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveProviderConfig, ProviderNotConfiguredError } from '@/lib/whatsapp/resolve-provider-config'
import {
  fetchEvolutionGroupInfo,
  fetchEvolutionGroupParticipants,
  fetchEvolutionGroupInviteCode,
  updateEvolutionGroupParticipants,
  updateEvolutionGroupSubject,
  updateEvolutionGroupDescription,
  updateEvolutionGroupPicture,
  leaveEvolutionGroup,
  type EvolutionInstanceConfig,
  type EvolutionParticipantAction,
} from '@/lib/whatsapp/evolution-api'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Backing API for the Inbox "Group info" panel (roadmap item #4):
 * participants, subject/description edits, group photo, invite link,
 * and leaving the group. Every call resolves `contactId` → the
 * synthetic group contact's `group_jid` (migration 049) → the
 * account's Evolution config, scoped to `accountId` throughout so one
 * account can never read or modify another's WhatsApp group.
 */

async function resolveGroupContext(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<{ groupJid: string; cfg: EvolutionInstanceConfig } | NextResponse> {
  const { data: contact, error: contactErr } = await supabase
    .from('contacts')
    .select('id, group_jid, is_group_placeholder')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (contactErr || !contact) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }
  if (!contact.is_group_placeholder || !contact.group_jid) {
    return NextResponse.json({ error: 'This contact is not a WhatsApp group' }, { status: 400 })
  }

  try {
    const { config } = await resolveProviderConfig(supabase, accountId, true)
    const cfg: EvolutionInstanceConfig = {
      apiUrl: config.api_url!,
      apiKey: decrypt(config.api_key!),
      instanceName: config.instance_name!,
    }
    return { groupJid: contact.group_jid as string, cfg }
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}

/** GET /api/whatsapp/evolution-group?contactId=... — group metadata + participants. */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const contactId = new URL(request.url).searchParams.get('contactId')
    if (!contactId) {
      return NextResponse.json({ error: 'contactId query param is required' }, { status: 400 })
    }

    const ctx = await resolveGroupContext(supabase, accountId, contactId)
    if (ctx instanceof NextResponse) return ctx

    const [info, participants] = await Promise.all([
      fetchEvolutionGroupInfo(ctx.cfg, ctx.groupJid),
      fetchEvolutionGroupParticipants(ctx.cfg, ctx.groupJid),
    ])
    return NextResponse.json({ info, participants })
  } catch (err) {
    return toErrorResponse(err)
  }
}

type GroupAction =
  | { action: 'participants'; participantAction: EvolutionParticipantAction; participants: string[] }
  | { action: 'updateSubject'; subject: string }
  | { action: 'updateDescription'; description: string }
  | { action: 'updatePicture'; image: string }
  | { action: 'inviteCode' }

/**
 * POST /api/whatsapp/evolution-group — body: `{ contactId, ...GroupAction }`.
 * A single dispatch endpoint (rather than one route per action) since
 * every action shares the same auth + group-resolution boilerplate and
 * none of them are called from more than one place in the UI.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const body = (await request.json()) as { contactId?: string } & Partial<GroupAction>
    const { contactId } = body
    if (!contactId) {
      return NextResponse.json({ error: 'contactId is required' }, { status: 400 })
    }

    const ctx = await resolveGroupContext(supabase, accountId, contactId)
    if (ctx instanceof NextResponse) return ctx
    const { cfg, groupJid } = ctx

    switch (body.action) {
      case 'participants': {
        if (!body.participantAction || !Array.isArray(body.participants) || body.participants.length === 0) {
          return NextResponse.json({ error: 'participantAction and participants[] are required' }, { status: 400 })
        }
        await updateEvolutionGroupParticipants(cfg, {
          groupJid,
          action: body.participantAction,
          participants: body.participants,
        })
        return NextResponse.json({ success: true })
      }
      case 'updateSubject': {
        if (!body.subject?.trim()) {
          return NextResponse.json({ error: 'subject is required' }, { status: 400 })
        }
        await updateEvolutionGroupSubject(cfg, { groupJid, subject: body.subject.trim() })
        return NextResponse.json({ success: true })
      }
      case 'updateDescription': {
        if (typeof body.description !== 'string') {
          return NextResponse.json({ error: 'description is required' }, { status: 400 })
        }
        await updateEvolutionGroupDescription(cfg, { groupJid, description: body.description })
        return NextResponse.json({ success: true })
      }
      case 'updatePicture': {
        if (!body.image?.trim()) {
          return NextResponse.json({ error: 'image is required' }, { status: 400 })
        }
        await updateEvolutionGroupPicture(cfg, { groupJid, image: body.image.trim() })
        return NextResponse.json({ success: true })
      }
      case 'inviteCode': {
        const result = await fetchEvolutionGroupInviteCode(cfg, groupJid)
        return NextResponse.json(result)
      }
      default:
        return NextResponse.json({ error: 'Unknown or missing action' }, { status: 400 })
    }
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      // Evolution API errors (throwEvolutionError) are plain Errors, not
      // the UnauthorizedError/ForbiddenError classes toErrorResponse()
      // maps — surface the message instead of collapsing to a generic 500
      // so the panel can show *why* (e.g. inviteCode's known "forbidden").
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/whatsapp/evolution-group?contactId=... — leave the group.
 * Gated at 'admin' (stricter than the other actions) since this is
 * irreversible and, per evolution-api.ts's own warning, was never
 * smoke-tested against a real instance before this panel shipped.
 */
export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const contactId = new URL(request.url).searchParams.get('contactId')
    if (!contactId) {
      return NextResponse.json({ error: 'contactId query param is required' }, { status: 400 })
    }

    const ctx = await resolveGroupContext(supabase, accountId, contactId)
    if (ctx instanceof NextResponse) return ctx

    await leaveEvolutionGroup(ctx.cfg, ctx.groupJid)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return toErrorResponse(err)
  }
}
