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
 */
export async function setEvolutionWebhook(
  args: EvolutionInstanceConfig & { webhookUrl: string; events: string[] },
): Promise<void> {
  const { apiUrl, apiKey, instanceName, webhookUrl, events } = args
  const response = await fetch(`${apiUrl}/webhook/set/${instanceName}`, {
    method: 'POST',
    headers: authHeaders(apiKey),
    body: JSON.stringify({
      webhook: { url: webhookUrl, webhook_by_events: true, events },
    }),
  })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error setting webhook: ${response.status}`)
  }
}

/** Event names this app subscribes to — see setEvolutionWebhook callers.
 *  MESSAGES_UPSERT alone covers both 1:1 and group messages (a group
 *  message is just one whose remoteJid ends in '@g.us'); the GROUPS_*
 *  events keep group metadata (subject, participants) in sync
 *  independent of message traffic. */
export const EVOLUTION_WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONNECTION_UPDATE',
  'GROUPS_UPSERT',
  'GROUPS_UPDATE',
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
// Groups (v1: read metadata + send into existing groups — does not
// create groups or manage membership from this app)
// ============================================================

export interface EvolutionGroupInfo {
  id: string
  subject: string
  creation: number
  owner: string
}

/** GET /group/findGroupInfos/{instanceName}?groupJid=... */
export async function fetchEvolutionGroupInfo(
  cfg: EvolutionInstanceConfig,
  groupJid: string,
): Promise<EvolutionGroupInfo> {
  const url = `${cfg.apiUrl}/group/findGroupInfos/${cfg.instanceName}?groupJid=${encodeURIComponent(groupJid)}`
  const response = await fetch(url, { headers: authHeaders(cfg.apiKey) })
  if (!response.ok) {
    await throwEvolutionError(response, `Evolution API error fetching group info: ${response.status}`)
  }
  return response.json()
}

export interface EvolutionGroupParticipant {
  id: string
  admin?: 'admin' | 'superadmin' | null
}

/**
 * VERIFY AGAINST A REAL INSTANCE: exact endpoint path — the docs index
 * lists a dedicated "get-participants" page separate from
 * findGroupInfos, but the precise path wasn't confirmed while writing
 * this file. `/group/participants/{instanceName}` is the best-guess
 * convention matching Evolution's other group routes; confirm before
 * relying on this in production.
 */
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
