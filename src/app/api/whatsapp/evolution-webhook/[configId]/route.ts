import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { fetchEvolutionGroupInfo, fetchEvolutionGroupParticipants } from '@/lib/whatsapp/evolution-api'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

// Mirrors the Meta webhook route's maxDuration rationale — group
// branch processing can add a group-info + participants lookup on top
// of the base message pipeline.
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConfigRow = any

// ============================================================
// Baileys-shaped webhook payload — VERIFY AGAINST A REAL INSTANCE.
// Field names below follow Baileys' well-documented proto message
// shape (stable across WhatsApp-Web-protocol libraries), but the exact
// envelope Evolution wraps it in (single object vs. `{ messages: [...] }`
// array, exact `event` string casing) was not confirmed against a live
// server while writing this file — see the fallback parsing in
// processEvolutionWebhook() below.
// ============================================================
interface EvolutionMessageKey {
  remoteJid: string
  fromMe: boolean
  id: string
  /** Only present on group messages — the actual sender within the
   *  group. Either `{digits}@s.whatsapp.net` (resolvable to a contact)
   *  or a `{id}@lid` linked-device identity (not a phone number; v1
   *  does not attempt to resolve these — see processGroupMessage). */
  participant?: string
}

interface EvolutionMessageContent {
  conversation?: string
  extendedTextMessage?: { text?: string }
  imageMessage?: { caption?: string; mimetype?: string; url?: string }
  videoMessage?: { caption?: string; mimetype?: string; url?: string }
  documentMessage?: {
    caption?: string
    fileName?: string
    mimetype?: string
    url?: string
  }
  audioMessage?: { mimetype?: string; url?: string }
  stickerMessage?: { mimetype?: string; url?: string }
  locationMessage?: {
    degreesLatitude?: number
    degreesLongitude?: number
    name?: string
    address?: string
  }
}

interface EvolutionMessageUpsertData {
  key: EvolutionMessageKey
  pushName?: string
  message?: EvolutionMessageContent
  messageTimestamp?: number
}

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

async function processEvolutionMessage(
  config: ConfigRow,
  data: EvolutionMessageUpsertData,
) {
  if (!data?.key?.remoteJid || !data.message) return
  // Evolution echoes our own outbound sends back through the same
  // event stream (fromMe: true) — not an inbound message.
  if (data.key.fromMe) return

  const parsed = parseEvolutionMessageContent(data.message)
  if (!parsed) return // system/protocol message (edit, reaction, poll, ...) — v1 doesn't ingest these

  const accountId = config.account_id as string
  const configOwnerUserId = config.user_id as string
  const remoteJid = data.key.remoteJid
  const isGroup = remoteJid.endsWith('@g.us')

  if (isGroup) {
    await processGroupMessage({
      config,
      data,
      remoteJid,
      parsed,
      accountId,
      configOwnerUserId,
    })
  } else {
    await process1to1Message({
      data,
      remoteJid,
      parsed,
      accountId,
      configOwnerUserId,
    })
  }
}

interface ParsedEvolutionContent {
  contentText: string | null
  mediaUrl: string | null
  contentType: 'text' | 'image' | 'video' | 'document' | 'audio' | 'location'
}

/**
 * Baileys message-content parser — deliberately produces the same
 * output shape as parseMessageContent() in the Meta webhook
 * (contentText / mediaUrl / a contentType the messages.content_type
 * CHECK constraint accepts) so downstream insert code is identical.
 * Returns null for message kinds this app doesn't ingest in v1
 * (reactions, edits, polls, protocol messages, ...).
 */
function parseEvolutionMessageContent(
  message: EvolutionMessageContent,
): ParsedEvolutionContent | null {
  if (message.conversation) {
    return { contentText: message.conversation, mediaUrl: null, contentType: 'text' }
  }
  if (message.extendedTextMessage?.text) {
    return { contentText: message.extendedTextMessage.text, mediaUrl: null, contentType: 'text' }
  }
  // VERIFY AGAINST A REAL INSTANCE: whether Evolution's webhook payload
  // carries a directly fetchable `url` (and whether it needs the
  // `apikey` header to download, or is a public/pre-signed link) —
  // not confirmed without a live server. Stored as-is for now; the
  // inbox will show a broken media link if this assumption is wrong,
  // which is the safest visible failure mode to debug against.
  if (message.imageMessage) {
    return {
      contentText: message.imageMessage.caption ?? null,
      mediaUrl: message.imageMessage.url ?? null,
      contentType: 'image',
    }
  }
  if (message.videoMessage) {
    return {
      contentText: message.videoMessage.caption ?? null,
      mediaUrl: message.videoMessage.url ?? null,
      contentType: 'video',
    }
  }
  if (message.documentMessage) {
    return {
      contentText: message.documentMessage.caption ?? message.documentMessage.fileName ?? null,
      mediaUrl: message.documentMessage.url ?? null,
      contentType: 'document',
    }
  }
  if (message.audioMessage) {
    return { contentText: null, mediaUrl: message.audioMessage.url ?? null, contentType: 'audio' }
  }
  if (message.stickerMessage) {
    // Stickers are images under the hood — same convention as the Meta
    // webhook (messages.content_type has no 'sticker' value).
    return { contentText: null, mediaUrl: message.stickerMessage.url ?? null, contentType: 'image' }
  }
  if (message.locationMessage) {
    const loc = message.locationMessage
    const locationText = [loc.name, loc.address, [loc.degreesLatitude, loc.degreesLongitude].filter((n) => n != null).join(',')]
      .filter(Boolean)
      .join(' - ')
    return { contentText: locationText || null, mediaUrl: null, contentType: 'location' }
  }
  return null
}

/** Digits-and-JID-suffix check for a resolvable 1:1/participant JID —
 *  `{digits}@s.whatsapp.net`, as opposed to a `{id}@lid` linked-device
 *  identity, which is not a phone number and isn't resolved in v1. */
function phoneFromWhatsAppJid(jid: string): string | null {
  const match = /^(\d+)@s\.whatsapp\.net$/.exec(jid)
  return match ? match[1] : null
}

async function process1to1Message(args: {
  data: EvolutionMessageUpsertData
  remoteJid: string
  parsed: ParsedEvolutionContent
  accountId: string
  configOwnerUserId: string
}) {
  const { data, remoteJid, parsed, accountId, configOwnerUserId } = args
  const phone = phoneFromWhatsAppJid(remoteJid)
  if (!phone) {
    console.warn('[evolution-webhook] unresolvable 1:1 remoteJid, skipping:', remoteJid)
    return
  }

  const contactOutcome = await findOrCreateContact(
    accountId,
    configOwnerUserId,
    phone,
    data.pushName || phone,
  )
  if (!contactOutcome) return

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactOutcome.contact.id)
  if (!convResult) return

  await insertInboundMessageAndDispatch({
    accountId,
    configOwnerUserId,
    contact: contactOutcome.contact,
    contactWasCreated: contactOutcome.wasCreated,
    conversation: convResult.conversation,
    conversationWasCreated: convResult.created,
    senderContactId: null, // sender_id only meaningful for group attribution
    data,
    parsed,
  })
}

async function processGroupMessage(args: {
  config: ConfigRow
  data: EvolutionMessageUpsertData
  remoteJid: string
  parsed: ParsedEvolutionContent
  accountId: string
  configOwnerUserId: string
}) {
  const { config, data, remoteJid, parsed, accountId, configOwnerUserId } = args

  const groupOutcome = await findOrCreateGroupContact(config, accountId, configOwnerUserId, remoteJid)
  if (!groupOutcome) return

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, groupOutcome.contact.id)
  if (!convResult) return

  // Mark the conversation as a group + best-effort refresh the
  // participant count. Only on newly-created conversations (or when we
  // just created the group contact) to avoid an extra Evolution API
  // call on every single group message.
  if (convResult.created || groupOutcome.wasCreated) {
    await markConversationAsGroup(config, convResult.conversation.id, remoteJid)
  }

  // Resolve the actual sender within the group.
  let senderContactId: string | null = null
  const participantJid = data.key.participant
  if (participantJid) {
    const participantPhone = phoneFromWhatsAppJid(participantJid)
    if (participantPhone) {
      const participantOutcome = await findOrCreateParticipantContact(
        accountId,
        configOwnerUserId,
        participantPhone,
        data.pushName || participantPhone,
      )
      senderContactId = participantOutcome?.contact.id ?? null
    }
    // else: `{id}@lid` linked-device identity — not a phone number.
    // v1 does not attempt to resolve these; sender_id stays null and
    // the inbox shows a generic "Someone in the group" attribution.
    // Known limitation, not a bug — see the Evolution API integration
    // plan.
  }

  await insertInboundMessageAndDispatch({
    accountId,
    configOwnerUserId,
    contact: groupOutcome.contact,
    contactWasCreated: groupOutcome.wasCreated,
    conversation: convResult.conversation,
    conversationWasCreated: convResult.created,
    senderContactId,
    data,
    parsed,
  })
}

async function markConversationAsGroup(config: ConfigRow, conversationId: string, groupJid: string) {
  const update: Record<string, unknown> = { is_group: true }
  try {
    const apiKey = decrypt(config.api_key)
    const participants = await fetchEvolutionGroupParticipants(
      { apiUrl: config.api_url, apiKey, instanceName: config.instance_name },
      groupJid,
    )
    update.group_participant_count = participants.length
  } catch (err) {
    // Best-effort — the group ingest itself must not fail because the
    // participant-count refresh did.
    console.warn('[evolution-webhook] fetchEvolutionGroupParticipants failed:', err)
  }
  const { error } = await supabaseAdmin().from('conversations').update(update).eq('id', conversationId)
  if (error) console.error('[evolution-webhook] markConversationAsGroup failed:', error)
}

interface ContactOutcome {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any
  wasCreated: boolean
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
): Promise<ContactOutcome | null> {
  const existing = await findExistingContact(supabaseAdmin(), accountId, phone, {
    excludeGroupPlaceholders: true,
  })
  if (existing) {
    if (name && name !== existing.name) {
      await supabaseAdmin()
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return { contact: existing, wasCreated: false }
  }

  const { data: created, error } = await supabaseAdmin()
    .from('contacts')
    .insert({ account_id: accountId, user_id: configOwnerUserId, phone, name: name || phone })
    .select()
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(supabaseAdmin(), accountId, phone, {
        excludeGroupPlaceholders: true,
      })
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[evolution-webhook] contact create error:', error)
    return null
  }
  return { contact: created, wasCreated: true }
}

// Participant resolution is the same find-or-create as a 1:1 contact —
// a group member is just a contact the account may or may not already
// know from outside the group.
const findOrCreateParticipantContact = findOrCreateContact

async function findOrCreateGroupContact(
  config: ConfigRow,
  accountId: string,
  configOwnerUserId: string,
  groupJid: string,
): Promise<ContactOutcome | null> {
  const { data: existing, error: findErr } = await supabaseAdmin()
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('group_jid', groupJid)
    .maybeSingle()
  if (findErr) {
    console.error('[evolution-webhook] group contact lookup error:', findErr)
    return null
  }
  if (existing) return { contact: existing, wasCreated: false }

  // Best-effort group name — falls back to the JID if Evolution can't
  // be reached right now; the contact row can be renamed later once
  // group metadata syncs (GROUPS_UPSERT / GROUPS_UPDATE, out of v1
  // ingestion scope alongside connection-state events).
  let subject = groupJid
  try {
    const apiKey = decrypt(config.api_key)
    const info = await fetchEvolutionGroupInfo(
      { apiUrl: config.api_url, apiKey, instanceName: config.instance_name },
      groupJid,
    )
    if (info?.subject) subject = info.subject
  } catch (err) {
    console.warn('[evolution-webhook] fetchEvolutionGroupInfo failed:', err)
  }

  const { data: created, error: createErr } = await supabaseAdmin()
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      // The JID's long digit prefix — never collides with a real E.164
      // phone number (see migration 049's comment). Kept because
      // contacts.phone is NOT NULL.
      phone: groupJid,
      name: subject,
      is_group_placeholder: true,
      group_jid: groupJid,
    })
    .select()
    .single()

  if (createErr) {
    if (isUniqueViolation(createErr)) {
      const { data: raced } = await supabaseAdmin()
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .eq('group_jid', groupJid)
        .maybeSingle()
      if (raced) return { contact: raced, wasCreated: false }
    }
    console.error('[evolution-webhook] group contact create error:', createErr)
    return null
  }
  return { contact: created, wasCreated: true }
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ conversation: any; created: boolean } | null> {
  // Same oldest-first / no-.single() convention as the Meta webhook's
  // findOrCreateConversation — see its comment (issue #363) for why
  // `.single()` here would snowball duplicates once any exist.
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (findError) {
    console.error('[evolution-webhook] conversation lookup error:', findError)
    return null
  }
  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false }
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from('conversations')
    .insert({ account_id: accountId, user_id: configOwnerUserId, contact_id: contactId })
    .select()
    .single()
  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (raced && raced.length > 0) return { conversation: raced[0], created: false }
    }
    console.error('[evolution-webhook] conversation create error:', createError)
    return null
  }
  return { conversation: newConv, created: true }
}

/**
 * Flags a still-unreplied broadcast_recipients row as replied. Mirrors
 * the Meta webhook's flagBroadcastReplyIfAny (broadcasts are Meta-only
 * in v1 — see broadcast/route.ts — but a contact reached by an old Meta
 * broadcast may have since reconnected via a group; harmless either
 * way). Best-effort — must never break the main inbound flow.
 */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)
    if (error || !recs || recs.length === 0) return

    const row = recs[0]
    const { error: updErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', row.id)
    if (updErr) console.error('[evolution-webhook] flag broadcast reply failed:', updErr)
  } catch (err) {
    console.error('[evolution-webhook] flagBroadcastReplyIfAny failed:', err)
  }
}

async function insertInboundMessageAndDispatch(args: {
  accountId: string
  configOwnerUserId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any
  contactWasCreated: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversation: any
  conversationWasCreated: boolean
  senderContactId: string | null
  data: EvolutionMessageUpsertData
  parsed: ParsedEvolutionContent
}) {
  const {
    accountId,
    configOwnerUserId,
    contact,
    contactWasCreated,
    conversation,
    conversationWasCreated,
    senderContactId,
    data,
    parsed,
  } = args

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
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const timestampMs = data.messageTimestamp ? data.messageTimestamp * 1000 : Date.now()

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'customer',
    // Only meaningful when the parent conversation is_group=true — see
    // migration 049's column comment. Null on every 1:1 message.
    sender_id: senderContactId,
    content_type: parsed.contentType,
    content_text: parsed.contentText,
    media_url: parsed.mediaUrl,
    message_id: data.key.id,
    status: 'delivered',
    created_at: new Date(timestampMs).toISOString(),
  })
  if (msgError) {
    console.error('[evolution-webhook] message insert error:', msgError)
    return
  }

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: parsed.contentText || `[${parsed.contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)
  if (convError) console.error('[evolution-webhook] conversation update error:', convError)

  // The reply-flag target is the actual sender (the participant inside
  // a group, or the 1:1 contact) — never the group's own placeholder.
  const replyFlagContactId = senderContactId ?? (conversation.is_group ? null : contact.id)
  if (replyFlagContactId) {
    await flagBroadcastReplyIfAny(accountId, replyFlagContactId)
  }

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
    text: parsed.contentText,
  })
}
