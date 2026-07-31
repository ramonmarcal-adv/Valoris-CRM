/**
 * Evolution API helpers — unofficial, self-hosted WhatsApp integration
 * (Baileys/WhatsApp-Web protocol), the only provider that can send/
 * receive WhatsApp GROUP messages (the Meta Cloud API cannot at all).
 *
 * Mirrors meta-api.ts's shape deliberately: one function per operation,
 * a single named-params object per call (same swapped-args rationale
 * as meta-api.ts's own header comment), one typed result per operation,
 * throw-on-non-2xx via a shared error helper.
 *
 * IMPORTANT — no live Evolution API server was available while writing
 * this file. Endpoint paths, request/response shapes, and header names
 * are taken from https://docs.evolutionfoundation.com.br (Evolution
 * API section) as of this writing. Every function below that has a
 * "VERIFY AGAINST A REAL INSTANCE" comment is the part most likely to
 * need adjustment once this runs against an actual deployed server —
 * treat those as the first things to smoke-test, not as settled.
 *
 * Deliberately out of v1 scope, no Evolution equivalent implemented:
 * approved WhatsApp templates and interactive buttons/lists — Baileys
 * has no standardized equivalent to either. Callers must reject these
 * message types for Evolution-routed sends rather than silently no-op.
 */

export interface EvolutionInstanceConfig {
  /** Base URL of the self-hosted Evolution API server, no trailing slash. */
  apiUrl: string
  /** Sent as the `apikey` header on every call. */
  apiKey: string
  instanceName: string
}

export interface EvolutionSendResult {
  messageId: string
}

// ============================================================
// Baileys-shaped message wire format — shared by the inbound webhook
// payload and the /chat/findMessages history response (same shape both
// places, confirmed against a real Evolution API v2.3.7 instance).
// Lives here (not in evolution-ingest.ts) so this file, the raw HTTP
// client layer, is the single owner of "what Evolution sends over the
// wire"; evolution-ingest.ts imports these rather than redefining them.
// ============================================================

export interface EvolutionMessageKey {
  remoteJid: string
  fromMe: boolean
  id: string
  /** Only present on group messages — the actual sender within the
   *  group, in whichever addressing mode WhatsApp used for this chat
   *  (see remoteJidAlt/participantAlt below). */
  participant?: string
  /**
   * WhatsApp's privacy-preserving "linked ID" addressing means
   * remoteJid is increasingly `{id}@lid` rather than a resolvable
   * phone-number JID — confirmed empirically that this is the
   * *common* case for real 1:1 chats, not an edge case. When present,
   * remoteJidAlt carries the resolvable `{digits}@s.whatsapp.net` form
   * of the same chat. Without it, the JID genuinely can't be resolved
   * to a phone number — known limitation, not a bug.
   */
  remoteJidAlt?: string
  /** Same Alt-JID pattern as remoteJidAlt, for the group participant. */
  participantAlt?: string
}

export interface EvolutionMessageContent {
  conversation?: string
  extendedTextMessage?: {
    text?: string
    /** VERIFY AGAINST A REAL INSTANCE: Baileys' usual shape for
     *  @mentions in a message (each entry a JID/lid, e.g.
     *  `"1234567890@lid"` or `"5511999999999@s.whatsapp.net"`) — not
     *  smoke-tested against a real Evolution payload yet. The message
     *  text itself carries a raw `@<digits>` placeholder per mentioned
     *  participant; evolution-ingest.ts resolves these against the
     *  group's participant list the same way it resolves @lid senders. */
    contextInfo?: { mentionedJid?: string[] }
  }
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

export interface EvolutionMessageUpsertData {
  key: EvolutionMessageKey
  pushName?: string
  message?: EvolutionMessageContent
  messageTimestamp?: number
}

interface EvolutionErrorResponse {
  message?: string | string[]
  error?: string
}

async function throwEvolutionError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as EvolutionErrorResponse
    if (Array.isArray(data.message)) message = data.message.join('; ')
    else if (typeof data.message === 'string') message = data.message
    else if (data.error) message = data.error
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', apikey: apiKey }
}

// ============================================================
// Instance lifecycle
// ============================================================

export interface CreateEvolutionInstanceArgs {
  apiUrl: string
  apiKey: string
  instanceName: string
}

export interface CreateEvolutionInstanceResult {
  instanceName: string
  instanceId?: string
}

/**
 * Creates the Evolution "instance" (WhatsApp session) this account will
 * connect. Treats "instance already exists" as success — this is called
 * every time the Settings form is saved, not just on first setup, so it
 * must be idempotent from the caller's perspective even if Evolution's
 * own API isn't.
 */
export async function createEvolutionInstance(
  args: CreateEvolutionInstanceArgs,
): Promise<CreateEvolutionInstanceResult> {
  const { apiUrl, apiKey, instanceName } = args
  const response = await fetch(`${apiUrl}/instance/create`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({ instanceName, integration: 'WHATSAPP-BAILEYS' }),
  })
  if (!response.ok) {
    // VERIFY AGAINST A REAL INSTANCE: confirm the exact status code and
    // error message Evolution returns for "instance already exists" so
    // this can be special-cased as success instead of surfacing an error
    // on every subsequent save.
    await throwEvolutionError(response, `Evolution API error creating instance: ${response.status}`)
  }
  const data = await response.json()
  return { instanceName, instanceId: data?.instance?.instanceId ?? data?.instanceId }
}

export interface EvolutionConnectResult {
  pairingCode: string | null
  /** Raw pairing code Evolution also returns alongside the QR image. */
  code: string
  /** Ready-to-render `data:image/png;base64,...` QR code image. */
  base64: string
  count: number
}

/** GET /instance/connect/{instanceName} — returns the QR code synchronously. */
export async function getEvolutionConnectQr(cfg: EvolutionInstanceConfig): Promise<EvolutionConnectResult> {
  const response = await fetch(`${cfg.apiUrl}/instance/connect/${cfg.instanceName}`, {
    headers: authHeaders(cfg.apiKey),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error requesting QR code: ${response.status}`)
  }
  return response.json()
}

export interface EvolutionConnectionState {
  /**
   * VERIFY AGAINST A REAL INSTANCE: the exact string values this can
   * take (documentation didn't confirm an enum). Treat 'open' as
   * "connected" per common Baileys convention; do not assume other
   * values without checking against a live server first.
   */
  state: string
}

/**
 * GET /instance/connectionState/{instanceName} — polled from the
 * Settings UI every 2-3s while a QR code is on screen, until `state`
 * indicates a connected session or a timeout is reached. Deliberately
 * not relying on the CONNECTION_UPDATE webhook event for this initial,
 * short, user-attended pairing window — see whatsapp-config.tsx.
 */
export async function getEvolutionConnectionState(cfg: EvolutionInstanceConfig): Promise<EvolutionConnectionState> {
  const response = await fetch(`${cfg.apiUrl}/instance/connectionState/${cfg.instanceName}`, {
    headers: authHeaders(cfg.apiKey),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error checking connection state: ${response.status}`)
  }
  const data = await response.json()
  return { state: data?.instance?.state ?? data?.state ?? 'unknown' }
}

/**
 * POST /webhook/set/{instanceName} — subscribes our inbound webhook
 * route to the given event types. Called once right after
 * createEvolutionInstance, before the operator scans the QR code, so
 * inbound events start flowing the moment the session connects.
 *
 * Payload shape confirmed against a real Evolution API v2.3.7 instance
 * (the "VERIFY AGAINST A REAL INSTANCE" this file originally shipped
 * with): `enabled` is REQUIRED — omitting it silently leaves the
 * webhook unregistered rather than erroring at the top level — and the
 * field is `webhookByEvents` (camelCase), not `webhook_by_events`.
 */
export async function setEvolutionWebhook(
  args: EvolutionInstanceConfig & { webhookUrl: string; events: string[] },
): Promise<void> {
  const { apiUrl, apiKey, instanceName, webhookUrl, events } = args
  const response = await fetch(`${apiUrl}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      webhook: { enabled: true, url: webhookUrl, webhookByEvents: true, events },
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error setting webhook: ${response.status}`)
  }
}

/** Event names this app subscribes to — see setEvolutionWebhook callers.
 *  MESSAGES_UPSERT alone covers both 1:1 and group messages (a group
 *  message is just one whose remoteJid ends in '@g.us'); the group
 *  events keep group metadata (subject, participants) in sync
 *  independent of message traffic. Confirmed against a real instance's
 *  validation error (400 on the earlier `GROUPS_UPDATE` guess) that
 *  the real enum value is singular: `GROUP_UPDATE`, not `GROUPS_UPDATE`. */
export const EVOLUTION_WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'GROUPS_UPSERT',
  'GROUP_UPDATE',
  'GROUP_PARTICIPANTS_UPDATE',
] as const

// ============================================================
// Sending
// ============================================================

export type EvolutionMediaKind = 'image' | 'video' | 'document' | 'audio'

export interface SendEvolutionTextArgs extends EvolutionInstanceConfig {
  /** Bare digits for a 1:1 recipient, or a full '...@g.us' JID for a group. */
  to: string
  text: string
  /** VERIFY AGAINST A REAL INSTANCE: exact field name for "reply to this
   *  message id" — Evolution's own reply/quote mechanism wasn't confirmed
   *  in the docs fetched for this plan. Wired here as a best-guess `quoted`
   *  object; treat as unverified. */
  quotedMessageId?: string
}

export async function sendEvolutionText(args: SendEvolutionTextArgs): Promise<EvolutionSendResult> {
  const { apiUrl, apiKey, instanceName, to, text, quotedMessageId } = args
  const body: Record<string, unknown> = { number: to, text }
  if (quotedMessageId) {
    body.quoted = { key: { id: quotedMessageId } }
  }
  const response = await fetch(`${apiUrl}/message/sendText/${instanceName}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error sending text: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data?.key?.id ?? data?.messageId }
}

export interface SendEvolutionMediaArgs extends EvolutionInstanceConfig {
  to: string
  kind: EvolutionMediaKind
  mediaUrl: string
  caption?: string
  filename?: string
}

export async function sendEvolutionMedia(args: SendEvolutionMediaArgs): Promise<EvolutionSendResult> {
  const { apiUrl, apiKey, instanceName, to, kind, mediaUrl, caption, filename } = args
  const body: Record<string, unknown> = {
    number: to,
    mediatype: kind,
    media: mediaUrl,
  }
  if (caption && kind !== 'audio') body.caption = caption
  if (filename) body.fileName = filename

  const response = await fetch(`${apiUrl}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error sending media: ${response.status}`)
  }
  const data = await response.json()
  return { messageId: data?.key?.id ?? data?.messageId }
}

// ============================================================
// Contacts
// ============================================================

/**
 * POST /chat/fetchProfilePictureUrl/{instanceName} — confirmed against
 * a real instance. Returns a direct, unencrypted, publicly-fetchable
 * URL (unlike message media, which is protocol-encrypted — see
 * getEvolutionMediaBase64 below) — usable straight in an `<img src>`.
 * Returns null when the number has no profile picture, or it's not
 * public (WhatsApp privacy settings); best-effort, not an error.
 */
export async function fetchEvolutionProfilePicture(
  cfg: EvolutionInstanceConfig,
  phone: string,
): Promise<string | null> {
  const response = await fetch(`${cfg.apiUrl}/chat/fetchProfilePictureUrl/${cfg.instanceName}`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ number: phone }),
  })
  if (!response.ok) return null
  const data = await response.json()
  return data?.profilePictureUrl ?? null
}

// ============================================================
// Groups (v1: read metadata + send into existing groups — does not
// create groups or manage membership from this app)
// ============================================================

export interface EvolutionGroupParticipant {
  /** `@lid` linked-device identity. */
  id: string
  /** Resolvable `{digits}@s.whatsapp.net` form of the same participant
   *  — same Alt-JID pattern as message keys' remoteJidAlt/
   *  participantAlt (see evolution-ingest.ts). Confirmed present on a
   *  real instance. */
  phoneNumber?: string
  admin?: 'admin' | 'superadmin' | null
  /** Display name, when WhatsApp has one for this participant. Confirmed
   *  present on a real instance — a far more reliable name source than
   *  a group message's `pushName`, which for an `@lid` participant is
   *  frequently just their numeric lid instead of an actual name. */
  name?: string | null
  /** Direct, unencrypted, publicly-fetchable profile photo URL — same
   *  convention as fetchEvolutionProfilePicture/EvolutionGroupInfo.pictureUrl.
   *  Confirmed present on a real instance. */
  imgUrl?: string | null
}

export interface EvolutionGroupInfo {
  id: string
  subject: string
  creation: number
  owner: string
  size?: number
  participants?: EvolutionGroupParticipant[]
  /** Direct, unencrypted, publicly-fetchable URL — same convention as
   *  fetchEvolutionProfilePicture — or null when the group has no
   *  photo. Confirmed present on a real instance. */
  pictureUrl?: string | null
  /** Group description ("info do grupo"). VERIFY AGAINST A REAL
   *  INSTANCE: findGroupInfos' description field name (`desc` vs
   *  `description`) wasn't confirmed — fetchEvolutionGroupInfo below
   *  normalizes both into this key, but an instance using a third name
   *  would silently read as "no description" rather than erroring. */
  description?: string | null
}

/** GET /group/findGroupInfos/{instanceName}?groupJid=... — confirmed
 *  against a real instance; response includes `participants` inline. */
export async function fetchEvolutionGroupInfo(
  cfg: EvolutionInstanceConfig,
  groupJid: string,
): Promise<EvolutionGroupInfo> {
  const url = `${cfg.apiUrl}/group/findGroupInfos/${cfg.instanceName}?groupJid=${encodeURIComponent(groupJid)}`
  const response = await fetch(url, { headers: authHeaders(cfg.apiKey) })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error fetching group info: ${response.status}`)
  }
  const data = await response.json()
  return { ...data, description: data?.desc ?? data?.description ?? null }
}

/** GET /group/participants/{instanceName}?groupJid=... — confirmed
 *  against a real instance (returns `{ participants: [...] }`). */
export async function fetchEvolutionGroupParticipants(
  cfg: EvolutionInstanceConfig,
  groupJid: string,
): Promise<EvolutionGroupParticipant[]> {
  const url = `${cfg.apiUrl}/group/participants/${cfg.instanceName}?groupJid=${encodeURIComponent(groupJid)}`
  const response = await fetch(url, { headers: authHeaders(cfg.apiKey) })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error fetching group participants: ${response.status}`)
  }
  const data = await response.json()
  return Array.isArray(data) ? data : (data?.participants ?? [])
}

/**
 * GET /group/fetchAllGroups/{instanceName}?getParticipants=false — every
 * group this instance is a member of. Confirmed against a real
 * instance. Used by the history-sync route to pre-create a synthetic
 * contact for every group up front, not just ones with already-fetched
 * message history.
 */
export async function fetchEvolutionAllGroups(
  cfg: EvolutionInstanceConfig,
): Promise<EvolutionGroupInfo[]> {
  const url = `${cfg.apiUrl}/group/fetchAllGroups/${cfg.instanceName}?getParticipants=false`
  const response = await fetch(url, { headers: authHeaders(cfg.apiKey) })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error fetching all groups: ${response.status}`)
  }
  return response.json()
}

// ============================================================
// Group management (v2 — write operations, added for the "Group info"
// panel roadmap item). Unlike the read functions above, these were
// NOT all smoke-tested against a real Evolution instance before this
// panel shipped — see each function's own comment for its verification
// status. Test destructive ones (leaveEvolutionGroup) against a
// disposable group first, never a real customer group.
// ============================================================

export type EvolutionParticipantAction = 'add' | 'remove' | 'promote' | 'demote'

/**
 * POST /group/updateParticipant/{instanceName} — confirmed to exist
 * against a real instance (endpoint responds, not a 404), but the
 * response shape on partial failure (e.g. one of several numbers not
 * on WhatsApp) was not exercised. `participants` are bare digit
 * strings, not JIDs — same convention as sendEvolutionText's `to`.
 */
export async function updateEvolutionGroupParticipants(
  cfg: EvolutionInstanceConfig,
  args: { groupJid: string; action: EvolutionParticipantAction; participants: string[] },
): Promise<void> {
  const response = await fetch(`${cfg.apiUrl}/group/updateParticipant/${cfg.instanceName}`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({
      groupJid: args.groupJid,
      action: args.action,
      participants: args.participants,
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error updating group participants: ${response.status}`)
  }
}

/**
 * POST /group/updateGroupSubject/{instanceName}.
 * VERIFY AGAINST A REAL INSTANCE: same naming convention as the
 * confirmed group endpoints, but never smoke-tested — test calls at
 * plan time timed out against a placeholder group. Confirm against a
 * disposable test group before relying on this in production.
 */
export async function updateEvolutionGroupSubject(
  cfg: EvolutionInstanceConfig,
  args: { groupJid: string; subject: string },
): Promise<void> {
  const response = await fetch(`${cfg.apiUrl}/group/updateGroupSubject/${cfg.instanceName}`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ groupJid: args.groupJid, subject: args.subject }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error updating group subject: ${response.status}`)
  }
}

/**
 * POST /group/updateGroupDescription/{instanceName}.
 * VERIFY AGAINST A REAL INSTANCE — same caveat as updateEvolutionGroupSubject.
 */
export async function updateEvolutionGroupDescription(
  cfg: EvolutionInstanceConfig,
  args: { groupJid: string; description: string },
): Promise<void> {
  const response = await fetch(`${cfg.apiUrl}/group/updateGroupDescription/${cfg.instanceName}`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ groupJid: args.groupJid, description: args.description }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error updating group description: ${response.status}`)
  }
}

/**
 * POST /group/updateGroupPicture/{instanceName} — confirmed to exist
 * against a real instance. `image` is a publicly-fetchable URL, same
 * convention as sendEvolutionMedia's `mediaUrl` (base64 data URIs are
 * also commonly accepted by Evolution for this field, but only the URL
 * form was confirmed).
 */
export async function updateEvolutionGroupPicture(
  cfg: EvolutionInstanceConfig,
  args: { groupJid: string; image: string },
): Promise<void> {
  const response = await fetch(`${cfg.apiUrl}/group/updateGroupPicture/${cfg.instanceName}`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ groupJid: args.groupJid, image: args.image }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error updating group picture: ${response.status}`)
  }
}

/**
 * GET /group/inviteCode/{instanceName}?groupJid=... — endpoint exists
 * but a real test call once returned "forbidden"; likely needs the bot
 * account to hold admin in the target group. Callers must handle the
 * thrown error and show it inline rather than treating "no invite
 * code" as a crash.
 */
export async function fetchEvolutionGroupInviteCode(
  cfg: EvolutionInstanceConfig,
  groupJid: string,
): Promise<{ inviteCode: string | null }> {
  const url = `${cfg.apiUrl}/group/inviteCode/${cfg.instanceName}?groupJid=${encodeURIComponent(groupJid)}`
  const response = await fetch(url, { headers: authHeaders(cfg.apiKey) })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error fetching invite code: ${response.status}`)
  }
  const data = await response.json()
  return { inviteCode: data?.inviteCode ?? data?.invite_code ?? data?.code ?? null }
}

/**
 * DELETE /group/leaveGroup/{instanceName}?groupJid=... — NEVER TESTED
 * against a real instance (destructive: removes this WhatsApp session
 * from the group with no undo). VERIFY AGAINST A REAL INSTANCE first,
 * using a disposable test group — do not exercise this against a real
 * customer group without a deliberate, confirmed decision to do so.
 */
export async function leaveEvolutionGroup(
  cfg: EvolutionInstanceConfig,
  groupJid: string,
): Promise<void> {
  const url = `${cfg.apiUrl}/group/leaveGroup/${cfg.instanceName}?groupJid=${encodeURIComponent(groupJid)}`
  const response = await fetch(url, { method: 'DELETE', headers: authHeaders(cfg.apiKey) })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error leaving group: ${response.status}`)
  }
}

// ============================================================
// History backfill (see docs/DEPLOYMENT.md / the Evolution API
// integration plan) — pulls existing chat history into the CRM once,
// via src/app/api/whatsapp/evolution-config/sync/route.ts.
// ============================================================

export interface EvolutionMessagesPageResult {
  total: number
  pages: number
  currentPage: number
  records: EvolutionMessageUpsertData[]
}

/**
 * POST /chat/findMessages/{instanceName} — confirmed against a real
 * instance: fixed page size of 50 (the `limit` field has no effect,
 * despite appearing in some Evolution docs — tested empirically),
 * newest-first, no working `sort` param. `page` is 1-indexed.
 */
export async function fetchEvolutionMessagesPage(
  cfg: EvolutionInstanceConfig,
  page: number,
): Promise<EvolutionMessagesPageResult> {
  const response = await fetch(`${cfg.apiUrl}/chat/findMessages/${cfg.instanceName}`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ where: {}, page }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error fetching messages: ${response.status}`)
  }
  const data = await response.json()
  return data.messages
}

// ============================================================
// Media download/decrypt
// ============================================================

export interface EvolutionMediaResult {
  /** Raw decrypted bytes. */
  buffer: Buffer
  mimetype: string
}

/**
 * POST /chat/getBase64FromMediaMessage/{instanceName} — confirmed
 * against a real instance. WhatsApp media (image/video/audio/document)
 * is protocol-encrypted at rest: the URL Evolution reports on the
 * message itself (message.imageMessage.url etc., ending in `.enc`) is
 * a `mmg.whatsapp.net` blob nothing can render directly. This endpoint
 * returns the already-decrypted bytes, base64-encoded, given just the
 * WhatsApp message id — used by the evolution-media proxy route
 * instead of ever exposing the raw `.enc` URL to the browser.
 */
export async function getEvolutionMediaBase64(
  cfg: EvolutionInstanceConfig,
  messageId: string,
): Promise<EvolutionMediaResult> {
  const response = await fetch(`${cfg.apiUrl}/chat/getBase64FromMediaMessage/${cfg.instanceName}`, {
    method: 'POST',
    headers: authHeaders(cfg.apiKey),
    body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error fetching media: ${response.status}`)
  }
  const data = await response.json()
  return { buffer: Buffer.from(data.base64, 'base64'), mimetype: data.mimetype || 'application/octet-stream' }
}
