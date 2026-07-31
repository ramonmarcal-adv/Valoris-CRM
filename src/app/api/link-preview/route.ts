import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

// ============================================================
// GET /api/link-preview?url=<encoded>
//
// Fetches a URL server-side and extracts Open Graph / Twitter Card
// metadata so message bubbles can render a WhatsApp-style link
// preview (item #2 of the Valoris CRM roadmap). The URL comes from
// message content — i.e. it's attacker-influenced (a customer can
// paste anything into a WhatsApp message) — so this reuses the same
// SSRF guard as outbound webhook delivery (src/lib/webhooks/ssrf.ts):
// reject private/loopback/link-local targets, and re-validate on
// every redirect hop rather than letting `fetch` follow blindly.
// ============================================================

const FETCH_TIMEOUT_MS = 6000
const MAX_REDIRECTS = 3
const MAX_BODY_BYTES = 512 * 1024 // enough for <head> on any real page

interface LinkPreviewResult {
  url: string
  title: string | null
  description: string | null
  image: string | null
  siteName: string | null
}

// Tiny in-memory cache, per server instance — avoids re-fetching the
// same link on every render of a conversation with a repeated URL.
// Not shared across instances/deploys; acceptable for a best-effort
// preview, not a source of truth.
const cache = new Map<string, { result: LinkPreviewResult; expiresAt: number }>()
const CACHE_TTL_MS = 30 * 60 * 1000

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function extractMetaTags(html: string): Map<string, string> {
  const meta = new Map<string, string>()
  const tagRe = /<meta\s+[^>]*>/gi
  const tags = html.match(tagRe) ?? []
  for (const tag of tags) {
    const keyMatch = tag.match(/(?:property|name)=["']([^"']+)["']/i)
    const contentMatch = tag.match(/content=["']([^"']*)["']/i)
    if (keyMatch && contentMatch) {
      meta.set(keyMatch[1].toLowerCase(), decodeEntities(contentMatch[1]))
    }
  }
  return meta
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  return match ? decodeEntities(match[1]) : null
}

async function fetchWithGuardedRedirects(startUrl: string): Promise<Response | null> {
  let current = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isDeliverableUrl(current))) return null
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Some sites refuse a bare/unknown UA on the og-scrape path.
        'User-Agent': 'Mozilla/5.0 (compatible; ValorisCRM-LinkPreview/1.0)',
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

export async function GET(request: Request) {
  try {
    await requireRole('viewer')

    const rawUrl = new URL(request.url).searchParams.get('url')
    if (!rawUrl) {
      return NextResponse.json({ error: 'url query param is required' }, { status: 400 })
    }

    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only http/https URLs are supported' }, { status: 400 })
    }

    const cacheKey = parsed.toString()
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.result)
    }

    let response: Response | null
    try {
      response = await fetchWithGuardedRedirects(cacheKey)
    } catch {
      response = null
    }
    if (!response || !response.ok || !response.body) {
      return NextResponse.json({ error: 'Could not fetch this link' }, { status: 502 })
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) {
      return NextResponse.json({ error: 'Not an HTML page' }, { status: 415 })
    }

    // Cap how much of the body we read — the <head> we need is always
    // near the top, and an unbounded read is a memory-exhaustion vector
    // against an attacker-chosen URL.
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let html = ''
    let bytesRead = 0
    while (bytesRead < MAX_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      bytesRead += value.byteLength
      html += decoder.decode(value, { stream: true })
    }
    await reader.cancel().catch(() => {})

    const meta = extractMetaTags(html)
    const result: LinkPreviewResult = {
      url: cacheKey,
      title: meta.get('og:title') ?? meta.get('twitter:title') ?? extractTitleTag(html),
      description: meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description') ?? null,
      image: meta.get('og:image') ?? meta.get('twitter:image') ?? null,
      siteName: meta.get('og:site_name') ?? parsed.hostname,
    }

    cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS })
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
