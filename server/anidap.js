// server/anidap.js — AniDap.lol scraper (Jul 2026).
//
// Pure DOM extraction via Puppeteer (cf-harvester.js). Navigates to
// the anidap.lol watch page and extracts the video src from the loaded
// player. No API calls — chad REST API is dead, old API blocks bots.
//
// Exports
// ───────
//   getInfoByAniListId(anilistId) → { slug, title, poster, totalEpisodes, ... }
//   getEpisodes(slug)              → [{ number, title?, ... }]
//   getProviders(slug, ep)         → [{ name, type }, ...]
//   getStream(slug, ep, provider, type) → { url, raw, headers?, tracks? }
//   getDownload(slug, ep, provider, type) → { sources, headers } | null
//   isRateLimited()                → boolean  (true only if 60%+ of providers blocked)
//   getRateLimitRemaining()        → number   (longest remaining cooldown)
//   getAllKnownProviders()         → [{ name, type }, ...]  (all 27 servers)
//   markProviderRateLimited()      → per-provider 429 tracking
//   isProviderRateLimited()        → check single provider

import { extractStreamFromWatchPage } from './cf-harvester.js'

// ── Constants ────────────────────────────────────────────────────────
const BASE = 'https://anidap.lol'

// Negative-result cache: remember when a specific provider/type/episode
// combination has no stream, so we don't keep paying the Puppeteer
// extraction cost on every click. Two TTLs:
//   - 10 min for confirmed empty chad responses (provider simply doesn't
//     have this episode).
//   - 2 min for extraction failures / timeouts (avoids hammering a sick
//     provider, but retries quickly once it recovers).
const noStreamCache = new Map()
const NO_STREAM_TTL_CONFIRMED = 10 * 60 * 1000
const NO_STREAM_TTL_FAILURE = 2 * 60 * 1000

// Positive-result cache: a working stream URL is valid for 10 minutes.
// The underlying HLS token is usually good for 1-2 hours, but signed
// URLs can expire or rotate faster, so 10 min is a safe balance between
// reducing upstream 429s and avoiding stale stream failures.
const streamCache = new Map()
const STREAM_TTL = 10 * 60 * 1000
const STREAM_CACHE_MAX_SIZE = 500

function getNoStream(key) {
  const entry = noStreamCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > entry.ttl) {
    noStreamCache.delete(key)
    return null
  }
  return entry
}
function setNoStream(key, ttl) {
  noStreamCache.set(key, { at: Date.now(), ttl })
}
function pruneNoStreamCache() {
  const now = Date.now()
  for (const [key, entry] of noStreamCache) {
    if (now - entry.at > entry.ttl) noStreamCache.delete(key)
  }
}

// Full known server matrix from anidap's providers.
// Source: vaishnavxd/anidap-scraper server matrix (Jun 2026).
// All servers are always returned — no filtering, no hiding.
const ALL_SUB_SERVERS = ['yuki', 'nuri', 'kami', 'koto', 'neko', 'beep', 'mochi', 'mimi', 'miku', 'vee', 'yume', 'uwu', 'shiro']
const ALL_DUB_SERVERS = ['yuki', 'nuri', 'kami', 'koto', 'neko', 'miku', 'vee', 'uwu']
const ALL_HSUB_SERVERS = ['mochi', 'kiwi', 'wave', 'shiro']

// Per-server health cache — tracks which servers are generally reachable.
// Key: `${name}:${type}`  Value: { ok: boolean, at: timestamp }
// TTL: 10 min — long enough to survive between scheduler ticks, short
//       enough that servers that come back online are detected quickly.
const serverHealthCache = new Map()
const SERVER_HEALTH_TTL = 10 * 60 * 1000

// ── Per-provider rate-limit tracking ─────────────────────────────────
// CRITICAL FIX (Jul 2026): Previously a single provider's 429 would
// trigger a GLOBAL 60-second cooldown that blocked ALL 27 servers.
// If yuki got rate-limited, kami/koto/neko/vee/uwu were ALL blocked
// too — even though they're different upstream CDNs.
//
// Now we track rate-limits PER-PROVIDER. Only the provider that got
// 429'd is blocked for 15s. All other providers continue to work.
// The global isRateLimited() only returns true when >= 60% of all
// providers are simultaneously rate-limited (site-wide block).

const providerRateLimit = new Map()  // provider name -> { until, secs }
const RATE_LIMIT_COOLDOWN = 15  // seconds per-provider (was 60s global)

/** Called when a SPECIFIC provider gets a 429.
 *  Only blocks that provider, not the whole site. */
export function markProviderRateLimited(provider, seconds = RATE_LIMIT_COOLDOWN) {
  if (!provider) return
  const until = Date.now() + seconds * 1000
  const existing = providerRateLimit.get(provider)
  if (!existing || until > existing.until) {
    providerRateLimit.set(provider, { until, secs: seconds })
  }
  console.warn(`[anidap] Provider ${provider} rate-limited - cooldown ${seconds}s`)
}

/** Check if a specific provider is currently rate-limited. */
export function isProviderRateLimited(provider) {
  if (!provider) return false
  const entry = providerRateLimit.get(provider)
  if (!entry) return false
  if (Date.now() >= entry.until) {
    providerRateLimit.delete(provider)
    return false
  }
  return true
}

/** Legacy: kept for backward compatibility with cf-harvester calls.
 *  Now routes to per-provider tracking instead of a global gate. */
export function markRateLimited(seconds = RATE_LIMIT_COOLDOWN, provider = null) {
  if (provider) {
    markProviderRateLimited(provider, seconds)
  } else {
    // No provider specified — log but don't block everything
    console.warn(`[anidap] Generic rate-limit mark (no provider specified) - ${seconds}s`)
  }
}

/** Returns true only if >= 60% of all known providers are simultaneously
 *  rate-limited, indicating a site-wide Cloudflare block. */
export function isRateLimited() {
  const allProviders = [...new Set([...ALL_SUB_SERVERS, ...ALL_DUB_SERVERS])]
  let limited = 0
  for (const name of allProviders) {
    if (isProviderRateLimited(`anidap-${name}`) || isProviderRateLimited(name)) limited++
  }
  const threshold = Math.ceil(allProviders.length * 0.6)
  return limited >= threshold
}

export function getRateLimitRemaining() {
  // Return the longest remaining cooldown among all limited providers
  let maxRemaining = 0
  const now = Date.now()
  for (const [, entry] of providerRateLimit) {
    const remaining = Math.ceil((entry.until - now) / 1000)
    if (remaining > maxRemaining) maxRemaining = remaining
  }
  return maxRemaining
}

// Lightweight availability cache — avoids hitting anidap.lol repeatedly.
// Key: anilistId, Value: { ok: boolean | null, at: timestamp }
// `ok: null` means "network failed, don't cache".
const availabilityCache = new Map()
const AVAILABILITY_TTL = 5 * 60 * 1000 // 5 min

async function checkAvailability(anilistId) {
  const cached = availabilityCache.get(anilistId)
  if (cached && Date.now() - cached.at < AVAILABILITY_TTL) return cached.ok

  try {
    const res = await fetch(`${BASE}/watch?id=${anilistId}&ep=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(4_000),
    })
    const text = await res.text()
    // Existing pages return 200 with a title like "Watch <Title> Sub/Dub...".
    // Missing pages return 500/404 or a generic title.
    const title = text.match(/<title>([^<]*)<\/title>/)?.[1] || ''
    const isGenericTitle = title.includes('Watch Anime Sub/Dub online Free')
    const hasErrorText = text.includes('Unexpected Server Error') || text.includes('Anime not found')
    const ok = res.status < 400 && !isGenericTitle && !hasErrorText
    availabilityCache.set(anilistId, { ok, at: Date.now() })
    return ok
  } catch (e) {
    // Network failure — don't cache, and stay optimistic so a brief outage
    // doesn't hide all anidap providers. The next request will retry.
    return true
  }
}

// ── Resolve slug/title -> numeric AniList ID ─────────────────────────
// anidap.lol keys content by AniList ID (?id=NNN). When the frontend only
// has a text slug (e.g. "jujutsu-kaisen") and no anilistId, we search
// AniList GraphQL by title to find the numeric ID. Cached for 30 min so
// repeated episode/provider requests don't re-hit AniList.
const anilistIdCache = new Map() // key: normalized title -> { at, id }
const ANILIST_ID_TTL = 30 * 60 * 1000

function slugToTitle(slug) {
  return String(slug || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function searchAnilistIdByTitle(title) {
  const key = title.toLowerCase().trim()
  if (!key) return null
  const cached = anilistIdCache.get(key)
  if (cached && Date.now() - cached.at < ANILIST_ID_TTL) return cached.id
  try {
    const resp = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: `query($s: String){Page(perPage: 5){media(search:$s, type:ANIME){id title{romaji english}}}}`,
        variables: { s: title },
      }),
      signal: AbortSignal.timeout(4_000),
    })
    const json = await resp.json()
    const results = json?.data?.Page?.media || []
    if (results.length > 0) {
      const id = results[0].id
      anilistIdCache.set(key, { at: Date.now(), id })
      console.log(`[anidap] Resolved title "${key}" -> AniList #${id}`)
      return id
    }
  } catch (e) {
    console.warn(`[anidap] AniList title search failed for "${key}":`, e.message)
  }
  return null
}

/** Resolve whatever the frontend gave us to a numeric AniList ID.
 *  1. Explicit anilistId wins.
 *  2. A numeric slug IS an AniList ID.
 *  3. Otherwise search AniList by title (route-provided english/romaji
 *     first, then a title derived from the slug itself). */
async function resolveAnilistId(slug, anilistId, titles = {}) {
  if (anilistId && !isNaN(Number(anilistId))) return Number(anilistId)
  if (slug && /^\d+$/.test(String(slug))) return Number(slug)
  const candidates = [
    titles?.english,
    titles?.romaji,
    slugToTitle(slug),
  ].filter(Boolean)
  for (const c of candidates) {
    const id = await searchAnilistIdByTitle(c)
    if (id) return id
  }
  return null
}

// ── Resolve AniList ID -> metadata ───────────────────────────────────
// Returns a stub with the AniList ID as slug (used directly by downstream
// functions). The frontend gets title/poster from AniList GraphQL.
export async function getInfoByAniListId(anilistId) {
  const id = Number(anilistId)
  if (!id || isNaN(id)) throw Object.assign(new Error('Invalid AniList ID'), { upstream: 400 })

  return {
    slug: String(id),
    title: `AniList #${id}`,
    poster: null,
    totalEpisodes: null,
    anilistId: id,
    source: 'anidap',
    _stub: true,
  }
}

// ── Episode list ──────────────────────────────────────────────────────
// Returns stub episodes (1-50). Real episode data and thumbnails come
// from AniZip on the frontend.
export async function getEpisodes(slug, anilistId, titles = {}) {
  const id = await resolveAnilistId(slug, anilistId, titles)
  if (!id) return []
  return Array.from({ length: 50 }, (_, i) => ({
    number: i + 1,
    id: `${id}-${i + 1}`,
  }))
}

// ── Server health cache helpers ───────────────────────────────────────

/** Return all known anidap servers regardless of health. */
export function getAllKnownProviders() {
  return [
    ...ALL_SUB_SERVERS.map(name => ({ name, type: 'sub' })),
    ...ALL_DUB_SERVERS.map(name => ({ name, type: 'dub' })),
    ...ALL_HSUB_SERVERS.map(name => ({ name, type: 'hsub' })),
  ]
}

/** Called by the health-check scheduler after probing a server. */
export function updateServerHealth(name, type, ok) {
  serverHealthCache.set(`${name}:${type}`, { ok, at: Date.now() })
}

/** Read cached health for a server. Returns true/false if cached,
 *  null if never probed or cache expired. */
export function getServerHealth(name, type) {
  const entry = serverHealthCache.get(`${name}:${type}`)
  if (!entry) return null
  if (Date.now() - entry.at > SERVER_HEALTH_TTL) {
    serverHealthCache.delete(`${name}:${type}`)
    return null
  }
  return entry.ok
}

// ── Provider/server list for an episode ───────────────────────────────
// Returns ALL known anidap servers — no filtering, no health probes.
// Every server is always shown. The user clicks to try each one.
export async function getProviders(slug, ep, anilistId, titles = {}) {
  const id = await resolveAnilistId(slug, anilistId, titles)
  if (!id) return []

  return [
    ...ALL_SUB_SERVERS.map(name => ({ name, type: 'sub' })),
    ...ALL_DUB_SERVERS.map(name => ({ name, type: 'dub' })),
    ...ALL_HSUB_SERVERS.map(name => ({ name, type: 'hsub' })),
  ]
}

// ── Fetch stream URL via chad API ─────────────────────────────────────
// Fetches sources from the browser context via cf-harvester.
export async function getStream(slug, ep, provider, type, anilistId, opts = {}) {
  const id = await resolveAnilistId(slug, anilistId, opts.titles)
  if (!id) return null
  if (!provider || !type) return null

  const epNum = Number(ep) || 1

  // Strip the anidap- prefix for the chad API call
  const bareProvider = provider.replace(/^anidap-/, '')

  // Fast-fail known-dead combinations without touching the browser.
  const noStreamKey = `${id}:${epNum}:${bareProvider}:${type}`

  // Positive-result cache: return a previously working stream without
  // touching the upstream chad API again.
  const cachedStream = streamCache.get(noStreamKey)
  if (cachedStream && Date.now() - cachedStream.at < STREAM_TTL) {
    console.log(`[anidap] Returning cached stream: ${id}:${epNum}/${bareProvider}/${type}`)
    return cachedStream.data
  }

  if (getNoStream(noStreamKey)) {
    console.log(`[anidap] Fast-fail cached no-stream: ${id}:${epNum}/${bareProvider}/${type}`)
    return null
  }

  // Skip if this specific provider is rate-limited (don't block others)
  if (isProviderRateLimited(bareProvider) || isProviderRateLimited(provider)) {
    console.log(`[anidap] Provider ${bareProvider} is rate-limited, skipping`)
    return null
  }

  // ── DOM extraction — the only reliable path (chad API is dead) ──
  // Skip the chad REST API entirely: it returns 403 bot_detected or 404
  // for every provider. Going straight to Puppeteer DOM extraction saves
  // 5-10 seconds per provider.
  try {
    const tStart = Date.now()
    const watchUrl = `${BASE}/watch?id=${id}&ep=${epNum}&type=${type}&provider=${bareProvider}`
    console.log(`[anidap] DOM extraction: ${watchUrl.slice(0, 120)}`)
    const domData = await extractStreamFromWatchPage(watchUrl, { maxDurationMs: 18_000 })
    if (domData && Array.isArray(domData.sources) && domData.sources.length > 0) {
      const streamUrl = domData.sources[0]?.url
      if (!streamUrl) {
        setNoStream(noStreamKey, NO_STREAM_TTL_CONFIRMED)
        return null
      }
      const tracks = (domData.tracks || []).map((t) => ({
        file: t.url || t.file || '',
        label: t.label || '',
        kind: t.kind || 'captions',
        default: t.default || false,
      }))
      const result = {
        url: streamUrl,
        raw: streamUrl,
        headers: { Referer: watchUrl },
        tracks: tracks.length > 0 ? tracks : null,
      }
      setStreamCache(noStreamKey, result)
      console.log(`[anidap] ✓ DOM stream: ${streamUrl.slice(0, 80)} (${Date.now() - tStart}ms)`)
      return result
    }
    console.log(`[anidap] DOM returned no sources for ${id}:${epNum}/${bareProvider}/${type} (${Date.now() - tStart}ms)`)
    setNoStream(noStreamKey, NO_STREAM_TTL_CONFIRMED)
  } catch (domErr) {
    console.warn(`[anidap] DOM extraction failed for ${id}:${epNum}/${bareProvider}/${type}:`, domErr.message)
    // Only mark rate-limited for actual 429s — not for timeouts or other errors
    if (domErr.upstream === 429 || domErr.message?.includes('too_many_requests')) {
      markProviderRateLimited(bareProvider, RATE_LIMIT_COOLDOWN)
    }
    // Transient errors: don't poison the cache (retry next time)
    if (!domErr.message?.includes('timeout') && !domErr.message?.includes('challenge') && !domErr.message?.includes('aborted')) {
      setNoStream(noStreamKey, NO_STREAM_TTL_FAILURE)
    }
  }

  return null
}

// Prune the negative cache AND the per-provider rate-limit map periodically
// so they don't grow unbounded over the process lifetime.
function pruneProviderRateLimit() {
  const now = Date.now()
  for (const [name, entry] of providerRateLimit) {
    if (now >= entry.until) providerRateLimit.delete(name)
  }
}
function pruneStreamCache() {
  const now = Date.now()
  for (const [key, entry] of streamCache) {
    if (now - entry.at > STREAM_TTL) streamCache.delete(key)
  }
}

/** Add to the positive-result cache, evicting the oldest entry if the
 *  cache has grown beyond its configured maximum size. */
function setStreamCache(key, data) {
  if (streamCache.size >= STREAM_CACHE_MAX_SIZE) {
    const oldestKey = streamCache.keys().next().value
    if (oldestKey !== undefined) streamCache.delete(oldestKey)
  }
  streamCache.set(key, { at: Date.now(), data })
}

setInterval(() => {
  pruneNoStreamCache()
  pruneProviderRateLimit()
  pruneStreamCache()
}, 60_000).unref()

// ── Download (chad REST download API is dead) ────────────────────────
export async function getDownload(slug, ep, provider, type) {
  return null
}
