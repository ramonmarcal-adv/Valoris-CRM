import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getEvolutionConnectQr } from '@/lib/whatsapp/evolution-api'

/**
 * GET /api/whatsapp/evolution-config/qr
 *
 * Fetches a fresh pairing QR code for the account's Evolution instance.
 * Called once when the Settings UI enters "waiting to scan" state, and
 * again whenever the operator clicks "Refresh QR".
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
    .select('api_url, api_key, instance_name')
    .eq('account_id', accountId)
    .eq('api_type', 'evolution')
    .maybeSingle()

  if (error || !config) {
    return NextResponse.json(
      { error: 'Evolution API not configured. Save your credentials first.' },
      { status: 400 },
    )
  }

  try {
    const apiKey = decrypt(config.api_key)
    const qr = await getEvolutionConnectQr({
      apiUrl: config.api_url,
      apiKey,
      instanceName: config.instance_name,
    })
    return NextResponse.json(qr)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
