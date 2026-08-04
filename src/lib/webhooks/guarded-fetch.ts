import { isDeliverableUrl } from './ssrf'

// ============================================================
// SSRF-guarded fetch, extracted out of link-preview/route.ts so it can
// be reused by other server-side "fetch a URL a customer/lead
// supplied" features (e.g. AI link-context grounding) without
// duplicating the redirect-revalidation logic. A Next.js App Router
// route file can only export HTTP-method handlers, so this couldn't
// stay there and still be importable.
// ============================================================

export interface GuardedFetchOptions {
  timeoutMs?: number
  maxRedirects?: number
  userAgent?: string
}

const DEFAULT_TIMEOUT_MS = 6000
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; ValorisCRM/1.0)'

/**
 * SSRF-guarded fetch that re-validates `isDeliverableUrl` on every hop
 * and follows redirects manually (capped) rather than letting `fetch`
 * follow blindly — a public URL can't 3xx-bounce to an internal one.
 * Returns null (never throws) for a blocked/unreachable URL.
 */
export async function fetchWithGuardedRedirects(
  startUrl: string,
  opts: GuardedFetchOptions = {},
): Promise<Response | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT

  let current = startUrl
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!(await isDeliverableUrl(current))) return null
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Some sites refuse a bare/unknown UA.
        'User-Agent': userAgent,
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return null
      current = new URL(location, current).toString()
      continue
    }
    return response
  }
  return null
}

/**
 * Reads a response body up to `maxBytes`, decoding as UTF-8 text.
 * Caps how much of a large/attacker-chosen page is read into memory.
 */
export async function readCappedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytesRead = 0
  while (bytesRead < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    bytesRead += value.byteLength
    text += decoder.decode(value, { stream: true })
  }
  await reader.cancel().catch(() => {})
  return text
}
