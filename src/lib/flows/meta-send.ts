import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import {
  sendEvolutionMedia,
  sendEvolutionText,
  type EvolutionMediaKind,
} from '@/lib/whatsapp/evolution-api'
import { resolveProviderConfig, ProviderNotConfiguredError } from '@/lib/whatsapp/resolve-provider-config'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Flows-side sender — routes each send through resolveProviderConfig
// (src/lib/whatsapp/resolve-provider-config.ts) so a flow works
// identically whether the account's primary WhatsApp number is Meta
// Cloud API or Evolution API. Mirrors src/lib/whatsapp/send-message.ts's
// provider branch; kept as a separate module (rather than importing
// that file directly) so the two engines don't fight over each
// other's shape — the phone-variant retry + DB persistence are
// obvious extraction candidates into a shared base once both stabilize.
//
// Evolution has no equivalent to Meta's approved-template system or
// standardized interactive buttons/lists (see evolution-api.ts's
// module doc) — those message kinds throw a clear
// "not supported via Evolution API" error rather than silently
// no-op-ing or misbehaving against Evolution's wire format.
// ------------------------------------------------------------

interface SendTextEngineArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so a flow authored by user A still sends through the
   *  WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the flow — used for INSERT audit columns
   *  and for resolving the agent's identity in logs. Not consulted
   *  for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
  /** Marks the persisted message row `ai_generated = true` so the inbox
   *  badges it as an AI reply. Only the auto-reply bot sets this;
   *  deterministic Flow/automation sends leave it false. */
  aiGenerated?: boolean
}

/** Resolved once per send: which provider this account's conversation
 *  routes to, plus the destination (phone or group JID) and decrypted
 *  secret needed to call it. Shared by the text/media/interactive
 *  senders below so the routing rule lives in exactly one place. */
interface ResolvedSend {
  provider: 'meta_cloud' | 'evolution'
  destination: string
  accessToken: string
  phoneNumberId: string | null
  apiUrl: string | null
  apiKey: string | null
  instanceName: string | null
  configId: string
  contactId: string
  isGroup: boolean
}

/**
 * Look up the conversation (for `is_group`), the contact (for phone /
 * group JID), and the account's provider config, then resolve which
 * provider this send goes through and to what destination. Shared by
 * every sender in this file.
 */
async function resolveSend(
  db: ReturnType<typeof supabaseAdmin>,
  args: { accountId: string; conversationId: string; contactId: string },
): Promise<ResolvedSend> {
  const { data: conversation, error: convErr } = await db
    .from('conversations')
    .select('is_group')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (convErr || !conversation) {
    throw new Error('conversation not found for this account')
  }
  const isGroup = !!conversation.is_group

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone, group_jid')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact) {
    throw new Error('contact not found for this account')
  }

  let destination: string
  if (isGroup) {
    if (!contact.group_jid) {
      throw new Error('group conversation has no group JID on its contact row')
    }
    destination = contact.group_jid
  } else {
    if (!contact.phone) {
      throw new Error('contact not found for this account')
    }
    const sanitized = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitized)) {
      throw new Error(`contact phone invalid: ${contact.phone}`)
    }
    destination = sanitized
  }

  let provider: 'meta_cloud' | 'evolution'
  let config: Awaited<ReturnType<typeof resolveProviderConfig>>['config']
  try {
    ;({ provider, config } = await resolveProviderConfig(db, args.accountId, isGroup))
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      throw new Error(err.message)
    }
    throw err
  }

  const encryptedSecret = provider === 'evolution' ? config.api_key : config.access_token
  const accessToken = decrypt(encryptedSecret!)

  return {
    provider,
    destination,
    accessToken,
    phoneNumberId: config.phone_number_id ?? null,
    apiUrl: config.api_url ?? null,
    apiKey: provider === 'evolution' ? accessToken : null,
    instanceName: config.instance_name ?? null,
    configId: config.id,
    contactId: contact.id,
    isGroup,
  }
}

/**
 * Send a plain-text WhatsApp message from the Flows engine.
 *
 * Used by the runner's `send_message` and `collect_input` nodes —
 * both prompt the customer with text and either auto-advance (the
 * send_message case) or suspend awaiting a text reply (collect_input).
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const resolved = await resolveSend(db, args)

  let waMessageId: string
  if (resolved.provider === 'evolution') {
    // No Meta-shaped "recipient not in allowed list" quirk to retry
    // around, and no E.164 variant concept for a group JID — one shot.
    try {
      const result = await sendEvolutionText({
        apiUrl: resolved.apiUrl!,
        apiKey: resolved.apiKey!,
        instanceName: resolved.instanceName!,
        to: resolved.destination,
        text: args.text,
      })
      waMessageId = result.messageId
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Evolution API error'
      throw new Error(`Evolution API error: ${message}`)
    }
  } else {
    const attempt = async (phone: string): Promise<string> => {
      const r = await sendTextMessage({
        phoneNumberId: resolved.phoneNumberId!,
        accessToken: resolved.accessToken,
        to: phone,
        text: args.text,
      })
      return r.messageId
    }
    waMessageId = await sendMetaWithPhoneRetry(db, resolved, attempt)
  }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  })
  if (msgErr) {
    throw new Error(`sent to provider but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

/**
 * Meta-only phone-variant retry, shared by the text/media senders
 * below. Numbers registered with/without a trunk 0 + Meta's sandbox
 * quirks all need this to reliably land a message. Evolution has no
 * such quirk (see resolveSend), so this path is Meta-only.
 */
async function sendMetaWithPhoneRetry(
  db: ReturnType<typeof supabaseAdmin>,
  resolved: ResolvedSend,
  attempt: (phone: string) => Promise<string>,
): Promise<string> {
  const variants = phoneVariants(resolved.destination)
  let workingPhone = resolved.destination
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== resolved.destination) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', resolved.contactId)
  }
  return waMessageId
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  /** Public URL Meta/Evolution fetches at send time. */
  link: string
  caption?: string
  /** Document-only; ignored by Meta for image/video. */
  filename?: string
}

/**
 * Send an image / video / document from the Flows engine.
 *
 * Used by the runner's `send_media` node. Auto-advances after the
 * send lands (same suspend semantics as send_message). Persists the
 * outgoing message with `content_type` matching the media kind so the
 * inbox renders the right preview.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const resolved = await resolveSend(db, args)

  let waMessageId: string
  if (resolved.provider === 'evolution') {
    try {
      const result = await sendEvolutionMedia({
        apiUrl: resolved.apiUrl!,
        apiKey: resolved.apiKey!,
        instanceName: resolved.instanceName!,
        to: resolved.destination,
        kind: args.kind as EvolutionMediaKind,
        mediaUrl: args.link,
        caption: args.caption,
        filename: args.filename,
      })
      waMessageId = result.messageId
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Evolution API error'
      throw new Error(`Evolution API error: ${message}`)
    }
  } else {
    const attempt = async (phone: string): Promise<string> => {
      const r = await sendMediaMessage({
        phoneNumberId: resolved.phoneNumberId!,
        accessToken: resolved.accessToken,
        to: phone,
        kind: args.kind,
        link: args.link,
        caption: args.caption,
        filename: args.filename,
      })
      return r.messageId
    }
    waMessageId = await sendMetaWithPhoneRetry(db, resolved, attempt)
  }

  // content_type='image'|'video'|'document' — these are already in the
  // messages_content_type_check constraint (migration 001 + 010).
  // content_text carries the caption (or empty) so the conversation
  // list preview shows something meaningful when the user glances at it.
  const preview = args.caption?.trim() || `[${args.kind}]`
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind,
    content_text: args.caption ?? null,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to provider but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/**
 * Send an interactive-button WhatsApp message from the Flows engine.
 *
 * Persists the outgoing message to `messages` with
 * `content_type='interactive'` and `sender_type='bot'` so the inbox
 * surfaces it with the "Button reply" affordance and the conversation
 * thread reflects the bot's prompt.
 *
 * Returns the Meta message id so the caller (engine) can stash it on
 * the `flow_runs.last_prompt_message_id` field for later reference.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

/**
 * Send an interactive-list WhatsApp message from the Flows engine.
 * Used when the flow needs more than 3 options (Meta's button cap).
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const resolved = await resolveSend(db, input)

  // Evolution/Baileys has no standardized equivalent to Meta's
  // interactive buttons/lists — reject explicitly rather than
  // silently no-op-ing or sending a Meta-shaped payload that would
  // misbehave against Evolution's wire format (same rule
  // send-message.ts enforces for the manual-send path).
  if (resolved.provider === 'evolution') {
    throw new Error(
      'Interactive (buttons/list) messages are not supported when sending via Evolution API.',
    )
  }

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId: resolved.phoneNumberId!,
        accessToken: resolved.accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList({
      phoneNumberId: resolved.phoneNumberId!,
      accessToken: resolved.accessToken,
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
    })
    return r.messageId
  }

  const waMessageId = await sendMetaWithPhoneRetry(db, resolved, attempt)

  // Persist the bot's prompt to the messages table so it appears in
  // the inbox. content_type='interactive' is supported as of
  // migration 010; sender_type='bot' distinguishes flow sends from
  // manual agent sends (the conversation list preview will pick up
  // last_message_text as a sensible summary).
  //
  // We do NOT set interactive_reply_id here — that column is reserved
  // for the customer's tap on this message, populated by the webhook
  // when their reply arrives. We DO persist the structured payload so
  // the inbox thread re-renders the buttons/rows the bot sent (round-
  // trip), matching the composer + automation send paths.
  const interactivePayload: InteractiveMessagePayload =
    input.kind === 'buttons'
      ? {
          kind: 'buttons',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          buttons: input.buttons,
        }
      : {
          kind: 'list',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          button_label: input.buttonLabel,
          sections: input.sections,
        }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: input.bodyText,
    interactive_payload: interactivePayload,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to provider but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: input.bodyText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
