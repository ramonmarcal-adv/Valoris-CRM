import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/whatsapp/active-provider
 *
 * Which WhatsApp provider 1:1 sends currently route through for this
 * account — mirrors resolveProviderConfig()'s own rule (the row marked
 * is_primary, falling back to the first row found). Used by the inbox
 * to decide whether Meta's 24-hour customer-service-window rule
 * applies to a 1:1 conversation: it's a Meta Cloud API / WhatsApp
 * Business Platform policy specifically, not a WhatsApp protocol rule,
 * so it's meaningless once Evolution is the account's active provider.
 * Any account member can read this — it's not sensitive, just a status
 * check every agent viewing the inbox needs.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data: rows, error } = await supabase
      .from('whatsapp_config')
      .select('api_type, is_primary')
      .eq('account_id', accountId)
    if (error) {
      console.error('[active-provider GET] fetch error:', error)
      return NextResponse.json({ error: 'Failed to load provider' }, { status: 500 })
    }

    const primary = rows?.find((r) => r.is_primary) ?? rows?.[0] ?? null
    return NextResponse.json({ provider: primary?.api_type ?? null })
  } catch (err) {
    return toErrorResponse(err)
  }
}
