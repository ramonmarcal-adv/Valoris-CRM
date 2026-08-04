import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkRateLimit, RATE_LIMITS, __resetRateLimitForTests } from '@/lib/rate-limit'
import type { ChatMessage } from './types'

const h = vi.hoisted(() => ({
  fetchWithGuardedRedirects: vi.fn(),
  readCappedBody: vi.fn(),
}))

vi.mock('@/lib/webhooks/guarded-fetch', () => ({
  fetchWithGuardedRedirects: h.fetchWithGuardedRedirects,
  readCappedBody: h.readCappedBody,
}))

import { extractFirstUrl, fetchPageTextForPrompt, resolveLinkContext } from './link-context'

function fakeHtmlResponse(html: string, contentType = 'text/html; charset=utf-8'): Response {
  h.readCappedBody.mockResolvedValueOnce(html)
  return {
    ok: true,
    body: {} as ReadableStream<Uint8Array>,
    headers: {
      get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null),
    },
  } as unknown as Response
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — several tests below exercise an
  // early-return path where `readCappedBody` is queued via
  // fakeHtmlResponse but never actually called (e.g. the non-HTML
  // content-type case), which would otherwise leave a stale queued
  // value for the next test's `mockResolvedValueOnce` to pick up.
  vi.resetAllMocks()
  __resetRateLimitForTests()
})

describe('extractFirstUrl', () => {
  it('finds a URL in text', () => {
    expect(extractFirstUrl('confira: https://site.com/x')).toBe('https://site.com/x')
  })

  it('returns null when there is no URL', () => {
    expect(extractFirstUrl('oi, tudo bem?')).toBeNull()
  })

  it('strips trailing sentence punctuation', () => {
    expect(extractFirstUrl('link: https://site.com/x.')).toBe('https://site.com/x')
    expect(extractFirstUrl('(veja https://site.com/x)')).toBe('https://site.com/x')
  })
})

describe('fetchPageTextForPrompt', () => {
  it('extracts body text, excluding script/style/nav', async () => {
    h.fetchWithGuardedRedirects.mockResolvedValueOnce(
      fakeHtmlResponse(
        '<html><head><style>.x{color:red}</style></head><body>' +
          '<nav>Menu principal</nav><script>evil()</script>' +
          '<p>Preço: R$ 3.020.000,00. Financiamento disponível para este imóvel em leilão.</p>' +
          '</body></html>',
      ),
    )
    const text = await fetchPageTextForPrompt('https://site.com/imovel-1')
    expect(text).toContain('Financiamento disponível')
    expect(text).not.toContain('evil()')
    expect(text).not.toContain('Menu principal')
  })

  it('returns null for a non-HTML content-type', async () => {
    h.fetchWithGuardedRedirects.mockResolvedValueOnce(
      fakeHtmlResponse('{"not":"html"}', 'application/json'),
    )
    const text = await fetchPageTextForPrompt('https://site.com/imovel-2')
    expect(text).toBeNull()
  })

  it('returns null when the SSRF-guarded fetch is blocked', async () => {
    h.fetchWithGuardedRedirects.mockResolvedValueOnce(null)
    const text = await fetchPageTextForPrompt('http://127.0.0.1/x')
    expect(text).toBeNull()
  })

  it('returns null and never throws when the fetch rejects (timeout/network error)', async () => {
    h.fetchWithGuardedRedirects.mockRejectedValueOnce(new Error('timeout'))
    await expect(fetchPageTextForPrompt('https://site.com/imovel-3')).resolves.toBeNull()
  })

  it('returns null for thin/empty extracted content (JS-rendered page)', async () => {
    h.fetchWithGuardedRedirects.mockResolvedValueOnce(
      fakeHtmlResponse('<html><body><div id="root"></div></body></html>'),
    )
    const text = await fetchPageTextForPrompt('https://site.com/imovel-4')
    expect(text).toBeNull()
  })

  it('caches a successful extraction — a second call does not re-fetch', async () => {
    h.fetchWithGuardedRedirects.mockResolvedValueOnce(
      fakeHtmlResponse(
        '<html><body><p>' + 'Financiamento disponível para este imóvel. '.repeat(3) + '</p></body></html>',
      ),
    )
    const url = 'https://site.com/imovel-5'
    const first = await fetchPageTextForPrompt(url)
    const second = await fetchPageTextForPrompt(url)
    expect(first).toEqual(second)
    expect(first).not.toBeNull()
    expect(h.fetchWithGuardedRedirects).toHaveBeenCalledTimes(1)
  })
})

describe('resolveLinkContext', () => {
  it('returns null and never fetches when there is no URL in the latest message', async () => {
    const result = await resolveLinkContext('acct-1', [{ role: 'user', content: 'oi' }])
    expect(result).toBeNull()
    expect(h.fetchWithGuardedRedirects).not.toHaveBeenCalled()
  })

  it('fetches the URL found in the latest customer message', async () => {
    h.fetchWithGuardedRedirects.mockResolvedValueOnce(
      fakeHtmlResponse(
        '<html><body><p>' + 'Financiamento disponível para este imóvel. '.repeat(3) + '</p></body></html>',
      ),
    )
    const messages: ChatMessage[] = [
      { role: 'user', content: 'confira este imóvel: https://site.com/imovel-6' },
    ]
    const result = await resolveLinkContext('acct-2', messages)
    expect(result).toContain('Financiamento disponível')
  })

  it('returns null without fetching once the account hits the link-fetch rate limit', async () => {
    const accountId = 'acct-rate-limited'
    for (let i = 0; i < RATE_LIMITS.aiLinkFetchAccount.limit; i++) {
      checkRateLimit(`ai-link-fetch:${accountId}`, RATE_LIMITS.aiLinkFetchAccount)
    }
    const messages: ChatMessage[] = [
      { role: 'user', content: 'confira: https://site.com/imovel-7' },
    ]
    const result = await resolveLinkContext(accountId, messages)
    expect(result).toBeNull()
    expect(h.fetchWithGuardedRedirects).not.toHaveBeenCalled()
  })
})
