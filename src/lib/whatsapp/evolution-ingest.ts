import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import {
  fetchEvolutionGroupInfo,
  fetchEvolutionGroupParticipants,
  fetchEvolutionProfilePicture,
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
  /** Raw JIDs/lids `@mentioned` in this message's text (Baileys'
   *  `contextInfo.mentionedJid`), before resolution to phone/name — null
   *  for every non-text message and every text message with no mentions. */
  mentionedJids: string[] | null
}

/**
 * Baileys message-content parser — produces the same output shape as
 * parseMessageContent() in the Meta webhook (contentText / mediaUrl / a
 * contentType the messages.content_type CHECK constraint accepts).
 * Returns null for message kinds this app doesn't ingest in v1
 * (reactions, edits, polls, protocol messages, ...).
 *
 * `messageId` (the WhatsApp message id, `data.key.id`) is required for
 * every media type: WhatsApp media is protocol-encrypted, so the raw
 * `url` Evolution reports on the message (ending in `.enc`) can't be
 * rendered directly by a browser. `mediaUrl` here always points at our
 * own `/api/whatsapp/evolution-media/[messageId]` proxy, which fetches
 * and decrypts on request — see getEvolutionMediaBase64() in
 * evolution-api.ts. Still null when the message genuinely has no
 * attachment `url` at all, so the "media unavailable" UI path is
 * unchanged for that case.
 */
export function parseEvolutionMessageContent(
  message: EvolutionMessageContent,
  messageId: string,
): ParsedEvolutionContent | null {
  const mediaProxyUrl = () => `/api/whatsapp/evolution-media/${messageId}`

  if (message.conversation) {
    return { contentText: message.conversation, mediaUrl: null, contentType: 'text', mentionedJids: null }
  }
  if (message.extendedTextMessage?.text) {
    const mentionedJid = message.extendedTextMessage.contextInfo?.mentionedJid
    return {
      contentText: message.extendedTextMessage.text,
      mediaUrl: null,
      contentType: 'text',
      mentionedJids: mentionedJid && mentionedJid.length > 0 ? mentionedJid : null,
    }
  }
  if (message.imageMessage) {
    return {
      contentText: message.imageMessage.caption ?? null,
      mediaUrl: message.imageMessage.url ? mediaProxyUrl() : null,
      contentType: 'image',
      mentionedJids: null,
    }
  }
  if (message.videoMessage) {
    return {
      contentText: message.videoMessage.caption ?? null,
      mediaUrl: message.videoMessage.url ? mediaProxyUrl() : null,
      contentType: 'video',
      mentionedJids: null,
    }
  }
  if (message.documentMessage) {
    return {
      contentText: message.documentMessage.caption ?? message.documentMessage.fileName ?? null,
      mediaUrl: message.documentMessage.url ? mediaProxyUrl() : null,
      contentType: 'document',
      mentionedJids: null,
    }
  }
  if (message.audioMessage) {
    return {
      contentText: null,
      mediaUrl: message.audioMessage.url ? mediaProxyUrl() : null,
      contentType: 'audio',
      mentionedJids: null,
    }
  }
  if (message.stickerMessage) {
    // Stickers are images under the hood — same convention as the Meta
    // webhook (messages.content_type has no 'sticker' value).
    return {
      contentText: null,
      mediaUrl: message.stickerMessage.url ? mediaProxyUrl() : null,
      contentType: 'image',
      mentionedJids: null,
    }
  }
  if (message.locationMessage) {
    const loc = message.locationMessage
    const locationText = [loc.name, loc.address, [loc.degreesLatitude, loc.degreesLongitude].filter((n) => n != null).join(',')]
      .filter(Boolean)
      .join(' - ')
    return { contentText: locationText || null, mediaUrl: null, contentType: 'location', mentionedJids: null }
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

interface ResolvedGroupParticipant {
  phone: string
  name?: string | null
  avatarUrl?: string | null
}

/** groupJid -> (lid -> resolved participant). Lets a caller processing
 *  many messages in one request (the history backfill's per-page loop,
 *  or a single live webhook delivery carrying several messages) fetch a
 *  given group's participant list once instead of once per message. */
export type LidParticipantCache = Map<string, Map<string, ResolvedGroupParticipant>>

/**
 * WhatsApp's `@lid` privacy addressing hides a group participant's real
 * number from the message itself — neither `key.participant` nor
 * `key.participantAlt` carry it (confirmed against a real instance: the
 * history endpoint never returns participantAlt at all, and essentially
 * every participant in this account's groups is `@lid`-only), and a
 * group message's `pushName` for an `@lid` sender is frequently just
 * their numeric lid rather than an actual name. The group's own
 * participant list is a separate, already-fetched-elsewhere endpoint
 * (see fetchEvolutionGroupParticipants, used today only for a
 * participant *count*) that maps each lid to a resolvable phone JID
 * plus a real display name and photo — confirmed against a real
 * instance (100% of a sampled group's participants resolved). This was
 * sitting unused. Best-effort: a participant who has since left the
 * group, or one Evolution itself can't resolve, leaves the message's
 * sender_id null same as before.
 */
async function resolveGroupParticipant(
  config: ConfigRow,
  groupJid: string,
  participantLid: string,
  cache?: LidParticipantCache,
): Promise<ResolvedGroupParticipant | null> {
  let lidMap = cache?.get(groupJid)
  if (!lidMap) {
    lidMap = new Map()
    try {
      const apiKey = decrypt(config.api_key)
      const participants = await fetchEvolutionGroupParticipants(
        { apiUrl: config.api_url, apiKey, instanceName: config.instance_name },
        groupJid,
      )
      for (const p of participants) {
        const phone = p.phoneNumber ? resolveJidPhone(p.phoneNumber) : null
        if (phone) lidMap.set(p.id, { phone, name: p.name, avatarUrl: p.imgUrl })
      }
    } catch (err) {
      console.warn('[evolution-ingest] fetchEvolutionGroupParticipants (lid resolution) failed:', err)
    }
    cache?.set(groupJid, lidMap)
  }
  return lidMap.get(participantLid) ?? null
}

export interface ResolvedMention {
  jid: string
  phone: string | null
  name: string | null
}

/**
 * Resolve one `@mentioned` JID (from parseEvolutionMessageContent's
 * `mentionedJids`) to a phone/name pair for display, reusing the same
 * group-participant list lookup (and its cache) as sender attribution.
 * Returns null when nothing resolves — an `@lid` mention whose
 * participant isn't in the group's current list — so message-bubble.tsx
 * can leave that one placeholder as raw text rather than showing a
 * misleadingly-empty name.
 */
async function resolveMentionedParticipant(
  config: ConfigRow,
  groupJid: string,
  mentionedJid: string,
  cache?: LidParticipantCache,
): Promise<ResolvedMention | null> {
  const directPhone = resolveJidPhone(mentionedJid)
  if (directPhone) return { jid: mentionedJid, phone: directPhone, name: null }
  const resolved = await resolveGroupParticipant(config, groupJid, mentionedJid, cache)
  if (!resolved) return null
  return { jid: mentionedJid, phone: resolved.phone, name: resolved.name ?? null }
}

export interface ContactOutcome {
  contact: ContactRow
  wasCreated: boolean
}

export async function findOrCreateContact(
  config: ConfigRow,
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
  /** Already-known avatar URL — e.g. a group's participant-list entry
   *  carries this for free. Skips the extra fetchEvolutionProfilePicture
   *  call below (used only on creation, same as that call). */
  avatarHint?: string | null,
): Promise<ContactOutcome | null> {
  const existing = await findExistingContact(supabaseAdmin(), accountId, phone, {
    excludeGroupPlaceholders: true,
  })
  if (existing) {
    // Never overwrite a name a human corrected by hand — see migration
    // 050. Rows created before that migration have no name_source yet
    // (column default only applies to new rows going forward via the
    // DB default, existing rows keep whatever they had at migration
    // time — which is 'whatsapp', so this check is safe either way).
    const nameIsAutoSynced = existing.name_source !== 'manual'
    if (name && name !== existing.name && nameIsAutoSynced) {
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

  // Profile picture — best-effort, only attempted once (on creation).
  // Deliberately NOT retried on every subsequent lookup of an existing
  // contact: a contact can be looked up hundreds of times during a
  // history backfill (once per message), and a number with genuinely
  // no public photo would otherwise trigger a fetch on every single
  // one — the same kind of sequential-call overload that caused the
  // group-name resolution failures this plan fixes elsewhere. A
  // separate one-time repair pass backfills avatars for contacts
  // created before this existed.
  if (avatarHint) {
    created.avatar_url = avatarHint
    await supabaseAdmin().from('contacts').update({ avatar_url: avatarHint }).eq('id', created.id)
  } else {
    try {
      const apiKey = decrypt(config.api_key)
      const pictureUrl = await fetchEvolutionProfilePicture(
        { apiUrl: config.api_url, apiKey, instanceName: config.instance_name },
        phone,
      )
      if (pictureUrl) {
        created.avatar_url = pictureUrl
        await supabaseAdmin().from('contacts').update({ avatar_url: pictureUrl }).eq('id', created.id)
      }
    } catch (err) {
      console.warn('[evolution-ingest] fetchEvolutionProfilePicture failed:', err)
    }
  }

  return { contact: created, wasCreated: true }
}

// Participant resolution is the same find-or-create as a 1:1 contact —
// a group member is just a contact the account may or may not already
// know from outside the group.
export const findOrCreateParticipantContact = findOrCreateContact

/** Wraps fetchEvolutionGroupInfo so both the creation path and the
 *  name-still-JID self-heal path share the identical try/catch/log. */
async function fetchGroupInfoBestEffort(config: ConfigRow, groupJid: string) {
  try {
    const apiKey = decrypt(config.api_key)
    return await fetchEvolutionGroupInfo(
      { apiUrl: config.api_url, apiKey, instanceName: config.instance_name },
      groupJid,
    )
  } catch (err) {
    console.warn('[evolution-ingest] fetchEvolutionGroupInfo failed:', err)
    return null
  }
}

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
  // Self-heal: a group whose name is still literally its own JID means
  // the very first fetchEvolutionGroupInfo call (below) failed — a real
  // failure mode seen in production (a small VPS making many sequential
  // per-group calls during a bulk sync hit transient errors for ~70% of
  // groups). findOrCreateGroupContact used to return early here and
  // never try again, so the bad name stuck forever even across repeated
  // "Importar histórico" runs. Retry once per call now instead.
  if (existing && existing.name === groupJid) {
    const refreshed = await fetchGroupInfoBestEffort(config, groupJid)
    if (refreshed) {
      const update: Record<string, unknown> = {}
      if (refreshed.subject) update.name = refreshed.subject
      if (refreshed.pictureUrl && !existing.avatar_url) update.avatar_url = refreshed.pictureUrl
      if (Object.keys(update).length > 0) {
        await supabaseAdmin().from('contacts').update(update).eq('id', existing.id)
        Object.assign(existing, update)
      }
    }
  }
  if (existing) return { contact: existing, wasCreated: false }

  // Best-effort group name + photo — falls back to the JID if Evolution
  // can't be reached right now (self-healed on a later call, above).
  const info = await fetchGroupInfoBestEffort(config, groupJid)
  const subject = info?.subject || groupJid

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
      avatar_url: info?.pictureUrl || null,
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
  options?: { flagBroadcastReply?: boolean; lidCache?: LidParticipantCache },
): Promise<UpsertEvolutionMessageResult | null> {
  if (!data?.key?.remoteJid || !data.message) return null

  const isOwnMessage = !!data.key.fromMe
  // fromMe messages reach here two ways: (1) Evolution echoing back a
  // send the CRM itself just made — already inserted at send time with
  // this exact message_id, so the idempotency check below no-ops it —
  // or (2) a message actually sent from the phone, bypassing the CRM
  // entirely, which has no prior record and must be inserted here or
  // it's lost. A previous version of this function couldn't tell those
  // apart and unconditionally dropped every live fromMe message,
  // silently swallowing every phone-sent reply (1:1 or group). The
  // caller (processEvolutionMessage) is responsible for skipping the
  // dispatch pipeline (flows/automations/AI-reply) on fromMe messages
  // regardless of which of the two cases this is.

  const parsed = parseEvolutionMessageContent(data.message, data.key.id)
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

    // Sender attribution (sender_id) is only meaningful for a message
    // that came FROM a group participant — an agent-sent backfilled
    // message doesn't need it (same convention as a live agent send,
    // which never sets sender_id either).
    if (!isOwnMessage) {
      let participantPhone = resolveJidPhone(data.key.participant, data.key.participantAlt)
      let participantName: string | null = null
      let participantAvatar: string | null = null
      if (!participantPhone && data.key.participant) {
        // `pushName` on an `@lid` sender is frequently just their
        // numeric lid, not a real name — the group's participant list
        // (fetched below to resolve the phone anyway) carries an
        // actual display name and photo, so prefer those over pushName
        // whenever this branch runs.
        const resolved = await resolveGroupParticipant(
          config,
          remoteJid,
          data.key.participant,
          options?.lidCache,
        )
        participantPhone = resolved?.phone ?? null
        participantName = resolved?.name ?? null
        participantAvatar = resolved?.avatarUrl ?? null
      }
      if (participantPhone) {
        const participantOutcome = await findOrCreateParticipantContact(
          config,
          accountId,
          configOwnerUserId,
          participantPhone,
          participantName || data.pushName || participantPhone,
          participantAvatar,
        )
        senderContactId = participantOutcome?.contact.id ?? null
      }
      // else: participant not resolvable even via the group's own
      // participant list (they've since left, or Evolution can't
      // resolve them either). sender_id stays null; the inbox shows a
      // generic "Someone in the group" attribution.
    }
  } else {
    const phone = resolveJidPhone(remoteJid, data.key.remoteJidAlt)
    if (!phone) {
      console.warn('[evolution-ingest] unresolvable 1:1 remoteJid, skipping:', remoteJid)
      return null
    }
    // pushName on a fromMe message is the account owner's OWN push name
    // (WhatsApp/Baileys convention — often literally "Você"/"You"), not
    // the customer's. resolveJidPhone above always resolves the chat
    // partner's phone regardless of who sent this particular message,
    // so blindly passing pushName here would overwrite a real customer
    // name with the owner's own name the next time they reply from
    // their phone. Pass '' instead: findOrCreateContact's existing-
    // contact branch treats a falsy name as "leave it alone", and its
    // creation branch already falls back to the phone number.
    const nameCandidate = isOwnMessage ? '' : data.pushName || phone
    contactOutcome = await findOrCreateContact(config, accountId, configOwnerUserId, phone, nameCandidate)
    if (!contactOutcome) return null
  }

  const convResult = await findOrCreateConversation(accountId, configOwnerUserId, contactOutcome.contact.id)
  if (!convResult) return null

  // Resolve @mentions (group-only — see ParsedEvolutionContent's doc
  // comment) against the same participant list/cache used for sender
  // attribution above, so a mention shows the real name instead of the
  // raw @<digits> placeholder Baileys puts in the text.
  let resolvedMentions: ResolvedMention[] | null = null
  if (isGroup && parsed.mentionedJids?.length) {
    const results = await Promise.all(
      parsed.mentionedJids.map((jid) =>
        resolveMentionedParticipant(config, remoteJid, jid, options?.lidCache),
      ),
    )
    const resolved = results.filter((r): r is ResolvedMention => r !== null)
    resolvedMentions = resolved.length > 0 ? resolved : null
  }

  if (isGroup && (convResult.created || contactOutcome.wasCreated)) {
    await markConversationAsGroup(config, convResult.conversation.id, remoteJid)
  }

  // Idempotency: message_id is not globally unique across the table
  // (same convention as the Meta webhook), so scope the existence
  // check to this conversation. Lets a backfill run be re-triggered
  // safely, and guards against Evolution redelivering the same event.
  const { data: existingMsg } = await supabaseAdmin()
    .from('messages')
    .select('id, sender_id')
    .eq('conversation_id', convResult.conversation.id)
    .eq('message_id', data.key.id)
    .maybeSingle()

  if (existingMsg) {
    // Self-heal: a group message imported before @lid participant
    // resolution existed has sender_id stuck null forever otherwise —
    // a re-run of "Importar histórico" only reaches this far because
    // the message already exists, so backfill it in place rather than
    // silently no-op-ing like a true duplicate.
    if (isGroup && !existingMsg.sender_id && senderContactId) {
      await supabaseAdmin().from('messages').update({ sender_id: senderContactId }).eq('id', existingMsg.id)
    }
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
    sender_type: isOwnMessage ? 'agent' : 'customer',
    // Only meaningful for a customer-sent group message — see
    // migration 049's column comment. Null on every 1:1 message and
    // on every agent-sent (isOwnMessage) message.
    sender_id: senderContactId,
    // Resolved @mentions (migration 051) — null except on a group
    // message whose text actually mentions someone.
    mentions: resolvedMentions,
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
      // A fromMe message (sent from the CRM or straight from the phone)
      // is the agent's own — it must not mark the thread unread for the
      // agent, the way an actual customer reply does.
      ...(isOwnMessage ? {} : { unread_count: (convResult.conversation.unread_count || 0) + 1 }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', convResult.conversation.id)
  if (convError) console.error('[evolution-ingest] conversation update error:', convError)

  // Broadcast-reply flagging means "the customer replied" — meaningless
  // (and, for a 1:1 thread, actively wrong: contactOutcome.contact is
  // the customer, not the agent) for a fromMe message.
  if (options?.flagBroadcastReply && !isOwnMessage) {
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
