import * as cheerio from 'cheerio'
import { fetchWithGuardedRedirects, readCappedBody } from '@/lib/webhooks/guarded-fetch'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { latestUserMessage } from './query'
import type { ChatMessage } from './types'

// ============================================================
// Best-effort grounding: when a lead shares a link in the conversation
// (e.g. a property listing URL), fetch the page and extract its
// readable text so the AI reply assistant can answer questions about
// it (price, payment methods, financing, etc.) instead of only seeing
// the raw URL string.
//
// Deterministic, not agentic — no provider adapter supports tool
// calling today, so this always fetches the first URL in the
// customer's latest message before generating a reply, rather than
// letting the model decide whether to fetch. One extra network call,
// zero extra LLM round-trips.
//
// Any domain is fetchable (not just the account's own site) — the
// fetched text is injected into the prompt with an explicit
// untrusted/never-as-instructions framing (see defaults.ts) since a
// lead could link to a page they control.
//
// Every failure mode here (SSRF-blocked, timeout, non-HTML, thin/empty
// extracted content, rate-limited) resolves to `null` — this must
// never throw and must never block reply generation.
// ============================================================

const URL_REGEX = /https?:\/\/[^\s]+/g

const FETCH_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 3
const MAX_BODY_BYTES = 512 * 1024
const MAX_EXTRACTED_CHARS = 4000
const MIN_EXTRACTED_CHARS = 50
const CACHE_TTL_MS = 30 * 60 * 1000
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000

/** First URL in `text`, with trailing sentence punctuation stripped
 *  (a customer typing "confira: https://site.com/x." shouldn't fetch
 *  a URL with a trailing period). Null if there's no URL. */
export function extractFirstUrl(text: string): string | null {
  const matches = text.match(URL_REGEX)
  if (!matches || matches.length === 0) return null
  return matches[0].replace(/[.,;:!?)\]}'"]+$/, '')
}

/**
 * HTML → readable body text. Strips script/style/nav/header/footer/
 * noscript/svg/iframe/form/button subtrees (not just single-line tags —
 * this is why cheerio is used here instead of the regex approach the
 * link-preview meta-tag extractor uses), then normalizes whitespace
 * and caps length. Returns null when the extracted text is too thin
 * to be useful — the graceful-degradation point for a JS-rendered
 * page (React/Vue/Next app shell with no server-rendered content) or
 * a page that blocked the fetch with a bot-check page.
 */
function extractReadableText(html: string): string | null {
  const $ = cheerio.load(html)
  $('script, style, noscript, nav, header, footer, svg, iframe, form, button').remove()
  const text = $('body').text().replace(/\s+/g, ' ').trim()
  if (text.length < MIN_EXTRACTED_CHARS) return null
  return text.slice(0, MAX_EXTRACTED_CHARS)
}

interface CacheEntry {
  /** Extracted text, or null for a cached "nothing useful" result
   *  (negative-cached with a shorter TTL so a transiently-broken page
   *  gets retried sooner than a confirmed-good one gets re-fetched). */
  text: string | null
  expiresAt: number
}

// Per-server-instance, same caveat as link-preview's cache — not
// shared across instances/deploys, acceptable for best-effort
// grounding rather than a source of truth.
const cache = new Map<string, CacheEntry>()

/**
 * Fetch a URL and extract readable page text for the AI prompt, with
 * an in-memory TTL cache so the same link isn't re-fetched on every
 * message in a conversation. Never throws.
 */
export async function fetchPageTextForPrompt(url: string): Promise<string | null> {
  const cached = cache.get(url)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.text
  }

  const cacheAndReturn = (text: string | null) => {
    const ttl = text ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS
    cache.set(url, { text, expiresAt: Date.now() + ttl })
    return text
  }

  try {
    const response = await fetchWithGuardedRedirects(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      userAgent: 'Mozilla/5.0 (compatible; ValorisCRM/1.0)',
    })
    if (!response || !response.ok || !response.body) {
      return cacheAndReturn(null)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) {
      return cacheAndReturn(null)
    }

    const html = await readCappedBody(response.body, MAX_BODY_BYTES)
    return cacheAndReturn(extractReadableText(html))
  } catch (err) {
    console.error(`[ai link-context] fetch/extract failed for ${url}:`, err)
    return cacheAndReturn(null)
  }
}

/**
 * Best-effort: find a URL in the latest customer message and return
 * its extracted page text, or null if there's no URL, the account is
 * link-fetch rate-limited, or extraction failed/degraded. Never
 * throws — callers can await this unconditionally right next to
 * `retrieveKnowledge` (see grounding.ts).
 */
export async function resolveLinkContext(
  accountId: string,
  messages: ChatMessage[],
): Promise<string | null> {
  const url = extractFirstUrl(latestUserMessage(messages))
  if (!url) return null

  const limit = checkRateLimit(`ai-link-fetch:${accountId}`, RATE_LIMITS.aiLinkFetchAccount)
  if (!limit.success) {
    console.warn(
      `[ai link-context] account ${accountId} hit the link-fetch rate limit — skipping.`,
    )
    return null
  }

  try {
    return await fetchPageTextForPrompt(url)
  } catch (err) {
    console.error('[ai link-context] unexpected failure, skipping:', err)
    return null
  }
}
