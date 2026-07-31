import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import {
  fetchEvolutionGroupInfo,
  fetchEvolutionGroupParticipants,
  type EvolutionMessageContent,
  type EvolutionMessageUpsertData,
} from '@/lib/whatsapp/evolution-api'

/**
 * Shared Evolution API ingestion core — contact/conversation/message
 * upsert logic used by BOTH the live inbound webhook
 * (evolution-webhook/[configId]/route.ts) and the history backfill
 * route (evolution-config/sync/route.ts). Keeping this in one place
 * means the two paths can never silently diverge on how a group gets
 * its synthetic contact, how a JID resolves to a phone, or what counts
 * as a duplicate message.
 *
 * Deliberately excludes automations/flows/AI-reply/outbound-webhook
 * dispatch — those only make sense for messages arriving live. A
 * historical backfill importing thousands of old messages must never
 * fire "new message" side effects, or every automation configured on
 * the account would replay against real contacts. Callers that DO want
 * live dispatch (the webhook route) add that layer themselves on top
 * of upsertEvolutionMessage()'s result.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
export function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConfigRow = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ContactRow = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConversationRow = any

// Wire-format types (EvolutionMessageKey/Content/UpsertData) live in
// evolution-api.ts, the raw HTTP client layer — re-exported here so
// existing callers of this module don't need a second import line.
export type {
  EvolutionMessageKey,
  EvolutionMessageContent,
  EvolutionMessageUpsertData,
} from '@/lib/whatsapp/evolution-api'

export interface ParsedEvolutionContent {
  contentText: string | null
  mediaUrl: string | null
  contentType: 'text' | 'image' | 'video' | 'document' | 'audio' | 'location'
}

/**
 * Baileys message-content parser — produces the same output shape as
 * parseMessageContent() in the Meta webhook (contentText / mediaUrl / a
 * contentType the messages.content_type CHECK constraint accepts).
 * Returns null for message kinds this app doesn't ingest in v1
 * (reactions, edits, polls, protocol messages, ...).
 */
export function parseEvolutionMessageContent(
  message: EvolutionMessageContent,
): ParsedEvolutionContent | null {
  if (message.conversation) {
    return { contentText: message.conversation, mediaUrl: null, contentType: 'text' }
  }
  if (message.extendedTextMessage?.text) {
    return { contentText: message.extendedTextMessage.text, mediaUrl: null, contentType: 'text' }
  }
  // VERIFY AGAINST A REAL INSTANCE: whether Evolution's payload carries
  // a directly fetchable `url` (and whether it needs the `apikey`
  // header to download, or is a public/pre-signed link) — not yet
  // confirmed against real media traffic. Stored as-is for now; the
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

/**
 * Resolve a WhatsApp JID to a phone number. Tries the primary JID
 * first (`{digits}@s.whatsapp.net`), then the Alt JID Evolution
 * supplies for `@lid`-addressed chats — see EvolutionMessageKey's
 * doc comment. Returns null when neither resolves (a genuine `@lid`
 * with no Alt available — known limitation, not a bug).
 */
export function resolveJidPhone(jid: string | undefined, altJid?: string): string | null {
  for (const candidate of [jid, altJid]) {
    if (!candidate) continue
    const match = /^(\d+)@s\.whatsapp\.net$/.exec(candidate)
    if (match) return match[1]
  }
  return null
}

export interface ContactOutcome {
  contact: ContactRow
  wasCreated: boolean
}

export async function findOrCreateContact(
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
    console.error('[evolution-ingest] contact create error:', error)
    return null
  }
  return { contact: created, wasCreated: true }
}

// Participant resolution is the same find-or-create as a 1:1 contact —
// a group member is just a contact the account may or may not already
// know from outside the group.
export const findOrCreateParticipantContact = findOrCreateContact

export async function findOrCreateGroupContact(
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
    console.error('[evolution-ingest] group contact lookup error:', findErr)
    return null
  }
  if (existing) return { contact: existing, wasCreated: false }

  // Best-effort group name — falls back to the JID if Evolution can't
  // be reached right now; the contact row can be renamed later once
  // group metadata syncs.
  let subject = groupJid
  try {
    const apiKey = decrypt(config.api_key)
    const info = await fetchEvolutionGroupInfo(
      { apiUrl: config.api_url, apiKey, instanceName: config.instance_name },
      groupJid,
    )
    if (info?.subject) subject = info.subject
  } catch (err) {
    console.warn('[evolution-ingest] fetchEvolutionGroupInfo failed:', err)
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
    console.error('[evolution-ingest] group contact create error:', createErr)
    return null
  }
  return { contact: created, wasCreated: true }
}

export async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
): Promise<{ conversation: ConversationRow; created: boolean } | null> {
  // Oldest-first / no-.single() — mirrors the Meta webhook's
  // findOrCreateConversation (issue #363): `.single()` here would
  // snowball duplicates once any exist.
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1)
  if (findError) {
    console.error('[evolution-ingest] conversation lookup error:', findError)
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
    console.error('[evolution-ingest] conversation create error:', createError)
    return null
  }
  return { conversation: newConv, created: true }
}

export async function markConversationAsGroup(config: ConfigRow, conversationId: string, groupJid: string) {
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
    console.warn('[evolution-ingest] fetchEvolutionGroupParticipants failed:', err)
  }
  const { error } = await supabaseAdmin().from('conversations').update(update).eq('id', conversationId)
  if (error) console.error('[evolution-ingest] markConversationAsGroup failed:', error)
}

export interface UpsertEvolutionMessageResult {
  contact: ContactRow
  contactWasCreated: boolean
  conversation: ConversationRow
  conversationWasCreated: boolean
  senderContactId: string | null
  /** Parsed content of the message that was (or would have been, if
   *  `inserted` is false) written — callers use this for dispatch
   *  payloads (message.received webhook, flow/automation trigger
   *  context) without re-deriving it from the raw Baileys shape. */
  parsed: ParsedEvolutionContent
  /** False when a row for this (conversation, message_id) already
   *  existed and the insert was skipped — lets backfill runs (and
   *  webhook retries) be re-run safely without duplicating rows. */
  inserted: boolean
}

/**
 * Core contact/conversation/message upsert for one Evolution message —
 * shared by the live webhook and the history backfill. Does NOT run
 * automations/flows/AI-reply/outbound-webhook dispatch; callers that
 * need that (the live webhook only) add it on top using the returned
 * ids. `flagBroadcastReply` defaults to false — backfilled history
 * shouldn't retroactively mutate broadcast analytics unless the caller
 * explicitly opts in (the live webhook does).
 */
export async function upsertEvolutionMessage(
  config: ConfigRow,
  data: EvolutionMessageUpsertData,
  options?: { flagBroadcastReply?: boolean },
): Promise<UpsertEvolutionMessageResult | null> {
  if (!data?.key?.remoteJid || !data.message) return null
  if (data.key.fromMe) return null // our own outbound, not inbound history

  const parsed = parseEvolutionMessageContent(data.message)
  if (!parsed) return null // system/protocol message (edit, reaction, poll, ...) — v1 doesn't ingest these

  const accountId = config.account_id as string
  const configOwnerUserId = config.user_id as string
  const remoteJid = data.key.remoteJid
  const isGroup = remoteJid.endsWith('@g.us')

  let contactOutcome: ContactOutcome | null
  let senderContactId: string | null = null

  if (isGroup) {
    contactOutcome = await findOrCreateGroupContact(config, accountId, configOwnerUserId, remoteJid)
    if (!contactOutcome) return null

    const participantPhone = resolveJidPhone(data.key.participant, data.key.participantAlt)
    if (participantPhone) {
      const participantOutcome = await findOrCreateParticipantContact(
        accountId,
        configOwnerUserId,
        participantPhone,
        data.pushName || participantPhone,
      )
      senderContactId = participantOutcome?.contact.id ?? null
    }
    // else: `@lid` participant with no Alt available — not a phone
    // number, can't be resolved. sender_id stays null; the inbox shows
    // a generic "Someone in the group" attribution. Known limitation.
  } else {
    const phone = resolveJidPhone(remoteJid, data.key.remoteJidAlt)
    if (!phone) {
      console.warn('[evolution-ingest] unresolvable 1:1 remoteJid, skipping:', remoteJid)
      return null
    }
    contactOutcome = await findOrCreateContact(accountId, configOwnerUserId, phone, data.pushName || phone)
    if (!contactOutcome) return null
  }

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactOutcome.contact.id)
  if (!convResult) return null

  if (isGroup && (convResult.created || contactOutcome.wasCreated)) {
    await markConversationAsGroup(config, convResult.conversation.id, remoteJid)
  }

  // Idempotency: message_id is not globally unique across the table
  // (same convention as the Meta webhook), so scope the existence
  // check to this conversation. Lets a backfill run be re-triggered
  // safely, and guards against Evolution redelivering the same event.
  const { data: existingMsg } = await supabaseAdmin()
    .from('messages')
    .select('id')
    .eq('conversation_id', convResult.conversation.id)
    .eq('message_id', data.key.id)
    .maybeSingle()

  if (existingMsg) {
    return {
      contact: contactOutcome.contact,
      contactWasCreated: contactOutcome.wasCreated,
      conversation: convResult.conversation,
      conversationWasCreated: convResult.created,
      senderContactId,
      parsed,
      inserted: false,
    }
  }

  const timestampMs = data.messageTimestamp ? data.messageTimestamp * 1000 : Date.now()

  const { error: msgError } = await supabaseAdmin().from('messages').insert({
    conversation_id: convResult.conversation.id,
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
    console.error('[evolution-ingest] message insert error:', msgError)
    return null
  }

  const { error: convError } = await supabaseAdmin()
    .from('conversations')
    .update({
      last_message_text: parsed.contentText || `[${parsed.contentType}]`,
      last_message_at: new Date(timestampMs).toISOString(),
      unread_count: (convResult.conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', convResult.conversation.id)
  if (convError) console.error('[evolution-ingest] conversation update error:', convError)

  if (options?.flagBroadcastReply) {
    const replyFlagContactId = senderContactId ?? (isGroup ? null : contactOutcome.contact.id)
    if (replyFlagContactId) {
      await flagBroadcastReplyIfAny(accountId, replyFlagContactId)
    }
  }

  return {
    contact: contactOutcome.contact,
    contactWasCreated: contactOutcome.wasCreated,
    conversation: convResult.conversation,
    conversationWasCreated: convResult.created,
    senderContactId,
    parsed,
    inserted: true,
  }
}

/**
 * Flags a still-unreplied broadcast_recipients row as replied. Mirrors
 * the Meta webhook's flagBroadcastReplyIfAny (broadcasts are Meta-only
 * in v1 — see broadcast/route.ts — but a contact reached by an old Meta
 * broadcast may have since reconnected via Evolution; harmless either
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
    if (updErr) console.error('[evolution-ingest] flag broadcast reply failed:', updErr)
  } catch (err) {
    console.error('[evolution-ingest] flagBroadcastReplyIfAny failed:', err)
  }
}
