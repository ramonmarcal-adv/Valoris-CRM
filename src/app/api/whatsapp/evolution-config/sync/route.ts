import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { fetchEvolutionAllGroups, fetchEvolutionMessagesPage } from '@/lib/whatsapp/evolution-api'
import {
  findOrCreateGroupContact,
  findOrCreateConversation,
  markConversationAsGroup,
  upsertEvolutionMessage,
} from '@/lib/whatsapp/evolution-ingest'

// One page of history (50 messages, Evolution's fixed page size — see
// fetchEvolutionMessagesPage) comfortably fits the same budget as the
// live webhook's per-message DB work.
export const maxDuration = 60

/**
 * POST /api/whatsapp/evolution-config/sync
 *
 * Body: `{ phase: 'groups' }` or `{ phase: 'messages', page: number }`.
 *
 * Pulls existing WhatsApp history into the CRM once Evolution API is
 * connected — the Settings UI drives this as two steps:
 *   1. 'groups' (one call): every group the instance belongs to gets a
 *      synthetic contact + conversation up front, so a group shows up
 *      correctly even before any of its history has been imported.
 *   2. 'messages' (repeated, incrementing `page`): imports one page of
 *      the account's full message history per call, oldest processing
 *      continuing until `done: true`. Deliberately does NOT run
 *      upsertEvolutionMessage()'s dispatch layer — see
 *      evolution-ingest.ts's module doc for why a backfill must never
 *      trigger automations/flows/AI replies/outbound webhooks.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json()
    const phase = (body as { phase?: string })?.phase

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('api_type', 'evolution')
      .maybeSingle()
    if (error || !config) {
      return NextResponse.json({ error: 'Evolution API not configured' }, { status: 400 })
    }

    const apiKey = decrypt(config.api_key)
    const cfg = { apiUrl: config.api_url, apiKey, instanceName: config.instance_name }
    const accountUserId = config.user_id as string

    if (phase === 'groups') {
      const groups = await fetchEvolutionAllGroups(cfg)
      let processed = 0
      for (const group of groups) {
        const groupOutcome = await findOrCreateGroupContact(config, accountId, accountUserId, group.id)
        if (!groupOutcome) continue
        const convResult = await findOrCreateConversation(accountId, accountUserId, groupOutcome.contact.id)
        if (!convResult) continue
        if (convResult.created || groupOutcome.wasCreated) {
          await markConversationAsGroup(config, convResult.conversation.id, group.id)
        }
        processed++
      }
      return NextResponse.json({ phase: 'groups', groupsFound: groups.length, processed, done: true })
    }

    if (phase === 'messages') {
      const page = Number((body as { page?: number })?.page) || 1
      const result = await fetchEvolutionMessagesPage(cfg, page)

      let inserted = 0
      for (const record of result.records) {
        const outcome = await upsertEvolutionMessage(config, record, { flagBroadcastReply: false, isBackfill: true })
        if (outcome?.inserted) inserted++
      }

      return NextResponse.json({
        phase: 'messages',
        page: result.currentPage,
        totalPages: result.pages,
        total: result.total,
        processed: result.records.length,
        inserted,
        done: result.currentPage >= result.pages,
      })
    }

    return NextResponse.json({ error: "phase must be 'groups' or 'messages'" }, { status: 400 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
