import { NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  supabaseAdmin,
  upsertEvolutionMessage,
  type ConfigRow,
  type EvolutionMessageUpsertData,
} from '@/lib/whatsapp/evolution-ingest'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

// Mirrors the Meta webhook route's maxDuration rationale — group
// branch processing can add a group-info + participants lookup on top
// of the base message pipeline.
export const maxDuration = 60

interface EvolutionWebhookBody {
  event?: string
  instance?: string
  data?: EvolutionMessageUpsertData | { messages?: EvolutionMessageUpsertData[] } | EvolutionMessageUpsertData[]
}

/**
 * POST /api/whatsapp/evolution-webhook/[configId]
 *
 * Auth: a per-row secret (`webhook_secret`, migration 048) passed as a
 * `?secret=` query param — the URL registered with Evolution via
 * setEvolutionWebhook() embeds it. Evolution has no HMAC-signing
 * convention like Meta's `x-hub-signature-256`, so this is the
 * equivalent gate: without the exact secret, the request is rejected
 * before the body is even parsed.
 *
 * Same `after()` pattern as the Meta webhook (src/app/api/whatsapp/
 * webhook/route.ts) and for the identical reason: ack within the
 * platform's response window, but keep the function alive long enough
 * for the DB writes to actually land (see issue #301 referenced there).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ configId: string }> },
) {
  const { configId } = await params
  const { searchParams } = new URL(request.url)
  const providedSecret = searchParams.get('secret')

  const config = await lookupConfigAndVerifySecret(configId, providedSecret)
  if (!config) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: EvolutionWebhookBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  after(async () => {
    try {
      await processEvolutionWebhook(config, body)
    } catch (error) {
      console.error('[evolution-webhook] processing failed:', error)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function lookupConfigAndVerifySecret(
  configId: string,
  providedSecret: string | null,
): Promise<ConfigRow | null> {
  if (!providedSecret) return null

  const { data: config, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('*')
    .eq('id', configId)
    .eq('api_type', 'evolution')
    .maybeSingle()
  if (error || !config || !config.webhook_secret) return null

  let expected: string
  try {
    expected = decrypt(config.webhook_secret)
  } catch (err) {
    console.error('[evolution-webhook] webhook_secret decrypt failed:', err)
    return null
  }

  const a = Buffer.from(providedSecret)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return null
  return crypto.timingSafeEqual(a, b) ? config : null
}

async function processEvolutionWebhook(
  config: ConfigRow,
  body: EvolutionWebhookBody,
) {
  // VERIFY AGAINST A REAL INSTANCE: only 'messages.upsert' (in whatever
  // casing Evolution actually sends — matched loosely below) is handled.
  // Other subscribed events (CONNECTION_UPDATE, GROUPS_UPSERT, etc.) are
  // intentionally no-ops here — connection state is read on demand by
  // the Settings UI's poll instead of persisted from this webhook.
  const eventName = (body.event ?? '').toLowerCase().replace(/[_.\s-]/g, '')
  if (eventName && eventName !== 'messagesupsert') return

  // VERIFY AGAINST A REAL INSTANCE: whether `data` is a single message
  // object, a `{ messages: [...] }` envelope, or already an array —
  // handle all three shapes defensively rather than guessing one.
  const raw = body.data
  const messages: EvolutionMessageUpsertData[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && 'messages' in raw && Array.isArray(raw.messages)
      ? raw.messages
      : raw && typeof raw === 'object' && 'key' in raw
        ? [raw as EvolutionMessageUpsertData]
        : []

  for (const data of messages) {
    await processEvolutionMessage(config, data).catch((err) =>
      console.error('[evolution-webhook] message processing failed:', err),
    )
  }
}

/**
 * Live-arrival wrapper around the shared upsertEvolutionMessage() core:
 * resolves contact/conversation/message (same logic the history
 * backfill uses), then — only here, never in the backfill — runs the
 * dispatch pipeline (broadcast-reply flag, flows, automations, AI
 * auto-reply, outbound webhooks) that makes sense for a message that
 * just actually arrived.
 */
async function processEvolutionMessage(
  config: ConfigRow,
  data: EvolutionMessageUpsertData,
) {
  const result = await upsertEvolutionMessage(config, data, { flagBroadcastReply: true })
  if (!result || !result.inserted) return

  // A fromMe message is either the CRM's own send echoing back (already
  // fully handled at send time) or one sent directly from the phone —
  // upsertEvolutionMessage() persists both, but neither should run the
  // customer-inbound dispatch pipeline below (flows/automations/AI
  // auto-reply/outbound webhooks): the same reason a backfilled message
  // never does either.
  if (data.key.fromMe) return

  const { contact, contactWasCreated, conversation, conversationWasCreated, parsed } = result
  const accountId = config.account_id as string
  const configOwnerUserId = config.user_id as string

  if (conversationWasCreated) {
    await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contact.id,
    })
  }

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer')
  // The message we just inserted is included in this count — a true
  // first message means the count is exactly 1 at this point.
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 1

  const inboundText = parsed.contentText ?? ''

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId: contact.id,
    conversationId: conversation.id,
    message: { kind: 'text', text: inboundText, meta_message_id: data.key.id },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactWasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contact.id,
      context: { message_text: inboundText, conversation_id: conversation.id },
    }).catch((err) => console.error('[evolution-webhook] automation dispatch failed:', err))
  }

  // AI auto-reply — dispatchInboundToAiReply itself refuses group
  // conversations (see src/lib/ai/auto-reply.ts), so no is_group check
  // is needed here; kept identical to the Meta webhook's call site.
  if (!flowConsumed && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: conversation.id,
      contactId: contact.id,
      configOwnerUserId,
    })
  }

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contact.id,
    whatsapp_message_id: data.key.id,
    content_type: parsed.contentType,
    text: inboundText,
  })
}
