// Shared low-level AniList GraphQL transport.
//
// AniList enforces a strict rate limit (currently ~30 requests/min, and it
// returns HTTP 429 with a `Retry-After` header when you exceed it). The app
// fires several feed queries at once on the Home page and more on Watch, so
// without backoff those bursts get throttled and whole rows silently fail.
//
// This module centralizes:
//   • 429 / 503 handling that RESPECTS the `Retry-After` header
//   • exponential backoff with jitter for transient 5xx / network errors
//   • a typed error so callers can detect rate-limiting vs. real failures
//
// Both the public (anilist.ts) and authenticated (anilistAuth.ts) layers go
// through here so retry behavior is identical everywhere.

import axios from 'axios'
import { getBackendOrigin } from '../lib/utils'

// Uses /api/anilist-gql backend proxy in localhost dev to avoid CORS;
// calls direct in browser/production where CORS is permissive.
const ENDPOINT = () =>
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? `${getBackendOrigin()}/api/anilist-gql`
    : 'https://graphql.anilist.co'
const MAX_RETRIES = 3
const MAX_BACKOFF_MS = 30_000

// Local stale cache: when AniList is rate-limiting or down, return the
// last successful response so the UI keeps working. Survives reloads.
const STORAGE_PREFIX = 'kurodo-anilist:'
const STALE_TTL = 24 * 60 * 60 * 1000 // 24h

function hashKey(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i)
    h |= 0
  }
  return h.toString(36)
}

function getStaleCacheKey(query: string, variables: Record<string, unknown>): string {
  return STORAGE_PREFIX + hashKey(query + JSON.stringify(variables ?? {}))
}

function readStaleCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; data: T }
    if (Date.now() - parsed.at > STALE_TTL) {
      localStorage.removeItem(key)
      return null
    }
    return parsed.data
  } catch {
    return null
  }
}

// Skip caching very large responses (e.g., big search/seasonal pages) so
// localStorage doesn't fill up with multi-MB GraphQL payloads.
const MAX_STALE_CACHE_ENTRY_SIZE = 100_000 // ~100KB

function writeStaleCache<T>(key: string, data: T): void {
  try {
    const payload = JSON.stringify({ at: Date.now(), data })
    if (payload.length > MAX_STALE_CACHE_ENTRY_SIZE) {
      console.warn('[anilistClient] stale cache entry too large, skipping', key, payload.length)
      return
    }
    localStorage.setItem(key, payload)
  } catch {
    // Storage full — clear oldest 25% and try once more
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_PREFIX))
      keys.slice(0, Math.ceil(keys.length / 4)).forEach((k) => localStorage.removeItem(k))
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
    } catch { /* give up */ }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) },
      { once: true },
    )
  })
}

/** Thrown after retries are exhausted on a 429 so callers can message it nicely. */
export class AniListRateLimitError extends Error {
  retryAfterMs: number
  constructor(retryAfterMs: number) {
    super('AniList rate limit reached — please wait a moment and try again.')
    this.name = 'AniListRateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

export interface AniListRequestOpts {
  /** Bearer token for authenticated queries/mutations. */
  token?: string
  timeout?: number
  signal?: AbortSignal
}

/**
 * POST a GraphQL operation to AniList with rate-limit-aware retries.
 * Returns the `data` field of the response; throws on GraphQL errors or
 * after exhausting retries.
 */
export async function anilistRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  opts: AniListRequestOpts = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`

  const cacheKey = getStaleCacheKey(query, variables)
  let attempt = 0
  for (;;) {
    let status = 0
    let data: { data?: T; errors?: Array<{ message?: string }> } | undefined
    let retryAfterSec: number | undefined
    let networkError: unknown

    try {
      const res = await axios.post(
        ENDPOINT(),
        { query, variables },
        {
          headers,
          timeout: opts.timeout ?? 15_000,
          signal: opts.signal,
          // Inspect every status ourselves so we can branch on 429/5xx.
          validateStatus: () => true,
        },
      )
      status = res.status
      data = res.data
      const ra = res.headers?.['retry-after']
      if (ra != null) retryAfterSec = Number(ra)
    } catch (e) {
      networkError = e
    }

    // Success path
    if (!networkError && status >= 200 && status < 300) {
      if (data?.errors?.length) {
        throw new Error(data.errors[0]?.message || 'AniList error')
      }
      // Cache successful response for stale-while-revalidate fallback
      if (typeof window !== 'undefined') {
        writeStaleCache(cacheKey, data?.data as T)
      }
      return data?.data as T
    }

    const isRateLimited = status === 429
    const isTransient =
      isRateLimited || status === 503 || status >= 500 || !!networkError

    // Non-retryable HTTP error (400/401/403/404…) — surface immediately.
    if (!isTransient) {
      const msg = data?.errors?.[0]?.message || `AniList returned ${status}`
      throw new Error(msg)
    }

    if (attempt >= MAX_RETRIES) {
      // If we exhausted retries, try to return a stale cached response
      // rather than breaking the UI entirely.
      if (typeof window !== 'undefined') {
        const stale = readStaleCache<T>(cacheKey)
        if (stale != null) {
          console.warn('[anilistClient] exhausted retries, returning stale cache')
          return stale
        }
      }
      if (isRateLimited) {
        throw new AniListRateLimitError((retryAfterSec ?? 60) * 1000)
      }
      if (networkError) throw networkError
      throw new Error(`AniList unavailable (HTTP ${status})`)
    }

    // Honor Retry-After when present (429/503), else exponential backoff
    // with jitter to avoid a thundering herd of identical retries.
    const backoff = Math.min(
      MAX_BACKOFF_MS,
      retryAfterSec != null
        ? retryAfterSec * 1000
        : 2 ** attempt * 1000 + Math.floor(Math.random() * 400),
    )
    await sleep(backoff, opts.signal)
    attempt++
  }
}
