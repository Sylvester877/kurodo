// server/anidap.js — AniDap.lol scraper (Jul 2026).
//
// Hybrid architecture:
//   1. FAST PATH (default): the chad REST API at chad.anidap.lol/rest/api
//      returns real sources/providers/episodes over plain HTTP with just
//      Referer/Origin/UA headers (the old api.anidap.lol host is dead).
//      The only requirement is the real text slug (e.g. "one-piece-p8k27"),
//      which is embedded in the watch page SSR HTML and cached after the
//      first resolve. This path is browser-free and resolves in ~0.5-1.5s
//      once the slug is cached.
//   2. BROWSER CHAD PATH: when the Node fetch gets bot_detected (403), the
//      browser context with real anidap.lol cookies still returns sources
//      (~2-6s).
//   3. DOM FALLBACK: if chad is unreachable and the slug can't be resolved,
//      navigate to the watch page via cf-harvester and extract the video
//      src from the loaded player (~15-25s).
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

import { extractStreamFromWatchPage, fetchChadSources } from './cf-harvester.js'

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

// Server roster fallback when chad can't answer (bot-blocked / network
// down). Updated for the Aug 2026 upstream re-shuffle — the legacy
// multi-1080p fleet (nuri/kami/koto/mochi/vee/yume/uwu) is GONE upstream:
// chad now serves the current names below, most of them 1080p-capable
// (verified live: sora/kiwi/neko/beep masters carry a 1920x1080 variant).
// Legacy names are kept LAST so an old cached stream or a server that
// comes back can still be used, without letting dead names crowd out the
// working ones.
const ALL_SUB_SERVERS = ['sora', 'kiwi', 'neko', 'beep', 'mimi', 'yuki', 'nuri', 'kami', 'koto', 'mochi', 'miku', 'shiro']
const ALL_DUB_SERVERS = ['mimi', 'yuki', 'neko', 'kiwi', 'sora', 'nuri', 'kami', 'koto', 'miku']
const ALL_HSUB_SERVERS = ['kiwi', 'mochi', 'wave', 'shiro']

// Live tips from the chad /servers API (Aug 2026). Used when chad itself
// can't be reached for the real per-episode list — keeps the picker's
// quality badges truthful instead of showing stale "1080p • Fastest" text.
const PROVIDER_TIPS = {
  sora: 'Soft sub, Fast, High quality',
  kiwi: 'Hard sub, Fast, High quality',
  neko: 'Hard sub, Fast, High quality',
  mimi: 'Soft sub, Fastest, High quality',
  beep: 'Soft sub, Fast',
  yuki: 'Soft sub, Good, Multi quality',
}

// Per-server health cache — tracks which servers are generally reachable.
// Key: `${name}:${type}`  Value: { ok: boolean, at: timestamp }
// TTL: 10 min — long enough to survive between scheduler ticks, short
//       enough that servers that come back online are detected quickly.
const serverHealthCache = new Map()
const SERVER_HEALTH_TTL = 10 * 60 * 1000// ── Per-provider rate-limit tracking ─────────────────────────────────
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
  // Site-wide chad blocks (429 by IP, or confirmed hard block) mean every
  // provider is down together — treat as globally rate-limited.
  if (isChad429Blocked() || isChadHardBlocked()) return true
  const allProviders = [...new Set([...ALL_SUB_SERVERS, ...ALL_DUB_SERVERS])]
  let limited = 0
  for (const name of allProviders) {
    if (isProviderRateLimited(`anidap-${name}`) || isProviderRateLimited(name)) limited++
  }
  const threshold = Math.ceil(allProviders.length * 0.6)
  return limited >= threshold
}

export function getRateLimitRemaining() {
  // Site-wide chad cooldowns win (longest window): 429 backoff first,
  // then the hard block (503). Without the hard-block term, a hard block
  // with no 429 would report "0s remaining" and the UI would loop.
  const chadRemaining = getChad429Remaining()
  if (chadRemaining > 0) return chadRemaining
  const hardBlockRemaining = isChadHardBlocked()
    ? Math.ceil((chadHardBlockedUntil - Date.now()) / 1000)
    : 0
  if (hardBlockRemaining > 0) return hardBlockRemaining
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

// ── CHAD REST API fast path (browser-free) ───────────────────────────
// The chad API moved to chad.anidap.lol/rest/api (the old api.anidap.lol
// host is dead). It returns REAL sources / providers / episodes directly
// over plain HTTP with just Referer/Origin/UA headers — no browser, no
// cookies, no mutex. The only requirement is the correct text slug (e.g.
// "one-piece-p8k27", NOT the AniList ID and NOT a kebab-cased title), which
// anidap embeds in the watch page's SSR HTML and which we cache here after
// the first resolve.
// bot_detected gate: when chad 403s once, it usually keeps blocking our IP
// for a while (request-burst fingerprint). While blocked we skip the chad
// fast path entirely and go straight to DOM extraction — and the router
// races only ONE candidate so the DOM path fits inside the route cap.
// The gate auto-clears after CHAD_BLOCK_TTL so a recovered chad API is
// picked up again without a server restart.
let chadBlockedUntil = 0
const CHAD_BLOCK_TTL = 5 * 60 * 1000

// Hard block: once chad 403s AND the browser-cookie chad path THROWS at
// the network level (the block reached our browser too), fail fast with a
// clear "upstream blocked" error instead of burning 20-25s per request on
// a doomed DOM extraction. NOTE: a browser path that returns EMPTY is NOT
// a hard block — that's a per-provider no-stream answer and must not take
// down the other providers for 10 minutes.
let chadHardBlockedUntil = 0
// Hard block is a LAST-RESORT kill-switch for confirmed bot blocks (403
// + browser network failure + real DOM timeout). Keep it short — the
// site-wide 429 backoff (retry_after-aware, ≤3 min) already covers IP
// rate-limits, and chad's own cooldowns are ~60s. A 10-min block turns
// one hiccup into "the whole app is broken" for the user.
const CHAD_HARD_BLOCK_TTL = 2 * 60 * 1000

export function isChadBlocked() {
  return Date.now() < chadBlockedUntil
}

function isChadHardBlocked() {
  return Date.now() < chadHardBlockedUntil
}

function markChadBlocked() {
  if (Date.now() >= chadBlockedUntil) {
    console.warn('[anidap] chad API bot_detected via Node fetch — switching to browser-cookie path for 5 min')
  }
  chadBlockedUntil = Date.now() + CHAD_BLOCK_TTL
}

function markChadHardBlocked() {
  chadHardBlockedUntil = Date.now() + CHAD_HARD_BLOCK_TTL
  console.warn(`[anidap] chad hard block confirmed (DOM path also failed) — fast-failing for ${Math.round(CHAD_HARD_BLOCK_TTL / 60000)} min`)
}

// Site-wide chad 429 tracking. chad rate-limits by IP, NOT per-provider:
// when one request gets a 429, every provider will 429 for the same
// window (the retry_after in the response body). Track that window and
// fail fast with a clean 429 instead of retrying every provider through
// the slow DOM path — the UI already shows a countdown + auto-retry.
let chad429Until = 0
const CHAD_429_MAX_TTL = 3 * 60 * 1000 // never block longer than 3 min

function markChad429(retryAfterMs) {
  const capped = Math.min(
    Math.max(Number(retryAfterMs) || 60_000, 15_000),
    CHAD_429_MAX_TTL,
  )
  chad429Until = Date.now() + capped
  console.warn(`[anidap] chad site-wide rate-limit — backing off ${Math.round(capped / 1000)}s`)
}

export function isChad429Blocked() {
  return Date.now() < chad429Until
}

export function getChad429Remaining() {
  return isChad429Blocked() ? Math.ceil((chad429Until - Date.now()) / 1000) : 0
}

/** Parse `retry_after` (ms) out of a chad 429 response body. */
export function chadRetryAfterMs(body) {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body
    const ms = Number(parsed?.retry_after)
    if (Number.isFinite(ms) && ms > 0) return ms
  } catch { /* not JSON */ }
  return 60_000
}

// ── chad API pacing (token-bucket + FIFO queue) ──────────────────────
// chad rate-limits per IP with a SITE-WIDE window (observed: ~86s lockout
// after a short burst). Bursts used to happen whenever the router raced
// 3-4 providers while server-verify probed several servers and the UI
// prefetched the next episode — one cold title could fire ~10 chad calls
// in 4s and lock EVERY server out at once (the "all servers broken"
// report). Pacing spreads calls evenly instead: never more than 5 chad
// calls per 10s, ≈350ms apart. Callers queue briefly rather than trip the
// global block — a ~1s delay beats an 86s lockout every time.
const CHAD_PACE_MAX_PER_WINDOW = 5
const CHAD_PACE_WINDOW_MS = 10_000
const CHAD_PACE_STAGGER_MS = 350
const chadPaceQueue = []
let chadPaceStamps = []
let chadPaceDraining = false
let chadPaceLastAt = 0
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function chadPace() {
  return new Promise((resolve) => {
    chadPaceQueue.push(resolve)
    drainChadPaceQueue()
  })
}

async function drainChadPaceQueue() {
  if (chadPaceDraining) return
  chadPaceDraining = true
  try {
    while (chadPaceQueue.length > 0) {
      const now = Date.now()
      chadPaceStamps = chadPaceStamps.filter((t) => now - t < CHAD_PACE_WINDOW_MS)
      if (chadPaceStamps.length >= CHAD_PACE_MAX_PER_WINDOW) {
        await sleep(Math.max(50, CHAD_PACE_WINDOW_MS - (now - chadPaceStamps[0]))
        )
        continue
      }
      const gap = now - chadPaceLastAt
      if (gap < CHAD_PACE_STAGGER_MS) await sleep(CHAD_PACE_STAGGER_MS - gap)
      const resolve = chadPaceQueue.shift()
      chadPaceStamps.push(Date.now())
      chadPaceLastAt = Date.now()
      resolve()
    }
  } finally {
    chadPaceDraining = false
  }
}

const CHAD_API = 'https://chad.anidap.lol/rest/api'
const CHAD_HEADERS = {
  'Referer': 'https://anidap.lol/',
  'Origin': 'https://anidap.lol',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
}
const slugResolveCache = new Map() // anilistId -> { at, slug }
const SLUG_RESOLVE_TTL = 12 * 60 * 60 * 1000 // 12h — slugs rarely change
// Single-flight map: while a slug resolve for an anilistId is in flight,
// concurrent requests await the same promise instead of re-fetching the
// watch page N times (wasted upstream load + extra bot-fingerprint risk).
const slugResolveInFlight = new Map() // anilistId -> Promise<string|null>

/** Drop a cached slug (and any in-flight resolve) so the next request
 *  re-resolves fresh. Called when chad reports the slug is gone, so a
 *  stale 12h cache entry can never trap the fast path in a 404 loop. */
function invalidateSlug(anilistId) {
  slugResolveCache.delete(anilistId)
  slugResolveInFlight.delete(anilistId)
}

/** Pull the real anidap text slug out of the watch page's SSR HTML.
 *  The page embeds it as a React prop: ..."http://anidap.lol/watch?id=21...",
 *  "id","one-piece-p8k27","anilistId",21 (with optional JSON backslash
 *  escapes). Anchor on the "id","<slug>","anilistId" prop sequence — the
 *  watch URL is a full http URL and varies, so URL anchoring is fragile. */
function extractSlugFromWatchHtml(html) {
  if (!html) return null
  const clean = html.replace(/\\"/g, '"').replace(/\\u0026/g, '&')
  const m = clean.match(/"id","([a-z0-9][a-z0-9-]{1,60})","anilistId"/)
  return m ? m[1] : null
}

/** Resolve AniList ID -> real anidap text slug (cached 12h).
 *  One cheap HTTP fetch of the watch page HTML — no browser needed. */
async function resolveAnidapSlug(anilistId) {
  if (!anilistId) return null
  const cached = slugResolveCache.get(anilistId)
  if (cached && Date.now() - cached.at < SLUG_RESOLVE_TTL) return cached.slug

  // Single-flight: concurrent callers share one watch-page fetch.
  const inFlight = slugResolveInFlight.get(anilistId)
  if (inFlight) return inFlight

  const p = (async () => {
    try {
      const watchUrl = `${BASE}/watch?id=${anilistId}&ep=1`
      const res = await fetch(watchUrl, {
        headers: { 'User-Agent': CHAD_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(9_000),
      })
      if (!res.ok) return null
      const html = await res.text()
      const slug = extractSlugFromWatchHtml(html)
      if (slug) {
        slugResolveCache.set(anilistId, { at: Date.now(), slug })
        console.log(`[anidap] Resolved slug: #${anilistId} -> ${slug}`)
        return slug
      }
    } catch (e) {
      console.warn(`[anidap] Slug resolve failed for #${anilistId}:`, e.message)
    }
    return null
  })().finally(() => slugResolveInFlight.delete(anilistId))

  slugResolveInFlight.set(anilistId, p)
  return p
}

/**
 * Minimal "is this a usable stream?" check on a resolved source.
 *
 * Earlier versions tried to detect "image slideshow" streams by inspecting
 * segment extensions and magic bytes, but that backfired: these CDNs serve
 * REAL MPEG-TS video under .jpg filenames (playeng/ani4.nukitashith.top),
 * prepend ByteDance ad-tracker PNGs to otherwise-fine playlists
 * (vivibebe), and flap between responses per request. Every heuristic
 * false-positived and turned working streams into "No stream available".
 *
 * We verify (a) the manifest isn't an HTML/empty error page, and (b) it
 * doesn't 4xx through the proxy. A definitive 4xx (the 404 placeholder the
 * chad API hands back when it has no real source, e.g.
 * vivibebe.site/public/stream/0) is rejected so the router falls through to
 * a provider that actually serves video instead of showing a black player.
 * 5xx + network errors stay lenient — a transient CDN hiccup shouldn't mark
 * a working stream dead. Cost: ONE ~200-400ms request through the internal
 * /proxy.
 */
async function isRealVideoStream(streamUrl, headers = null) {
  try {
    // Fetch THROUGH the internal /proxy — that's the exact path the
    // player uses, with the full anti-bot header set + referer rotation.
    // Direct server fetches are fingerprint-blocked by these CDNs (403
    // bot pages), which made direct validation useless.
    const origin = `http://127.0.0.1:${Number(process.env.PORT) || 5173}`
    // Prefer upstream-provided headers (e.g. chad tells us the CDN needs
    // Referer: megaplay.buzz) — validating with a guessed referer can 403
    // and reject a stream that would actually play.
    const referer = headers?.Referer || headers?.referer || playerRefererFor(streamUrl)
    const h = encodeURIComponent(
      Buffer.from(JSON.stringify({ Referer: referer })).toString('base64'),
    )
    const res = await fetch(`${origin}/proxy?url=${encodeURIComponent(streamUrl)}&h=${h}`, {
      signal: AbortSignal.timeout(4_000),
    })
    // Definitive 4xx through the proxy (404/410 gone, 403/401 blocked, 429
    // rate-limited) means the player — which loads via this SAME /proxy —
    // will fail identically. Reject it so the router falls through to a real
    // provider. Previously this returned `true` (lenient), which let upstream
    // placeholder streams (vivibebe.site/public/stream/0 → 404) through as
    // "playable" and produced a black player.
    if (res.status >= 400 && res.status < 500) return false
    if (!res.ok) return true // 5xx/transient — be lenient, let the player try
    const body = (await res.text()).trim()
    if (!body) return false // empty manifest is not a real stream
    if (body.startsWith('<') || body.startsWith('Request failed')) return false // HTML/bot error page
    if (!body.startsWith('#EXTM3U')) return false // binary/JSON junk — not a manifest
    // ── Variant sanity check ──
    // The uwu/aniwatchtv masters USUALLY load (#EXTM3U) while their video
    // variants are dead (403 SPA blob). hls.js then fatal-errors on the
    // variant. One extra ~300ms probe of the FIRST variant turns "dead link
    // at play time" into "fallback at pick time" — the router falls through
    // to a provider that actually plays. Masters that ARE media playlists
    // (no STREAM-INF) have no variants to check.
    if (body.includes('#EXT-X-STREAM-INF')) {
      const variantLine = body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith('#'))
      if (variantLine && variantLine.includes('/proxy?url=')) {
        // ⚠ DOUBLED-PROXY BUG GUARD: the /proxy rewrites RELATIVE variant
        // paths against the UPSTREAM base, but if this master text was
        // already rewritten once (served from the /proxy's own manifest
        // cache after a proxy hop), the "relative" lines are actually
        // '/proxy?url=…' URLs. Resolving those against the upstream base
        // produced bd.aniwatchtv.site/proxy?url=… → 404 at play time — the
        // "master loads, every segment 404s" bug. Detect and treat the
        // already-proxied line as the variant URL directly.
        try {
          const inner = decodeURIComponent(variantLine.split('url=')[1]?.split('&')[0] || '')
          if (/^https?:/i.test(inner)) {
            const vRes = await fetch(`${origin}/proxy?url=${encodeURIComponent(inner)}&h=${h}`, {
              signal: AbortSignal.timeout(4_000),
            })
            if (vRes.status >= 400 && vRes.status < 500) return false
            if (vRes.ok) {
              const vBody = (await vRes.text()).trim()
              if (!vBody.startsWith('#EXTM3U')) return false // SPA HTML, dead variant
            }
          }
        } catch { /* variant probe hiccup — trust the master */ }
      } else if (variantLine) {
        try {
          const vAbs = /^https?:/i.test(variantLine)
            ? variantLine
            : new URL(variantLine, new URL(streamUrl)).href
          const vRes = await fetch(`${origin}/proxy?url=${encodeURIComponent(vAbs)}&h=${h}`, {
            signal: AbortSignal.timeout(4_000),
          })
          if (vRes.status >= 400 && vRes.status < 500) return false
          if (vRes.ok) {
            const vBody = (await vRes.text()).trim()
            if (!vBody.startsWith('#EXTM3U')) return false // SPA HTML, dead variant
          }
        } catch { /* variant probe hiccup — trust the master */ }
      }
    }
    return true // anything m3u8-shaped is playable
  } catch {
    return true // validation failure — let the player try
  }
}

/** Is a CACHED stream still playable? Probes its master manifest through
 *  /proxy exactly like the player does. Returns false only on a definitive
 *  client error (4xx other than 429) — transient 5xx/timeouts count as
 *  alive so a brief CDN hiccup doesn't nuke a good cache entry.
 *  Probe budget: 4s. The manifest cache (30s) makes this ~free when the
 *  same master was fetched moments ago. */
async function isCachedStreamAlive(data) {
  if (!data?.url) return false
  const origin = `http://127.0.0.1:${Number(process.env.PORT) || 5173}`
  const referer = data.headers?.Referer || data.headers?.referer || playerRefererFor(data.url)
  const h = encodeURIComponent(
    Buffer.from(JSON.stringify({ Referer: referer })).toString('base64'),
  )
  try {
    const res = await fetch(`${origin}/proxy?url=${encodeURIComponent(data.url)}&h=${h}`, {
      signal: AbortSignal.timeout(4_000),
    })
    // 429 = upstream rate window, not a dead link — keep serving the cache
    // (the player's own requests would hit the same window anyway).
    if (res.status === 429) return true
    if (res.status >= 400) return false
    const head = (await res.text()).trimStart().slice(0, 8)
    return head.startsWith('#EXTM3U')
  } catch {
    return true // probe failed (network hiccup) — assume alive
  }
}

/** Pick the player Referer that unlocks a stream host's CDN.
 *  The fast path sets this directly so the /proxy doesn't need a 403
 *  retry round-trip on every manifest/segment request. */
function playerRefererFor(streamUrl) {
  try {
    const host = new URL(streamUrl).hostname
    // kryntal.top (anidap's current CDN, Aug 2026) requires the megaplay
    // referer — anidap.lol/no-referer both get 403 (verified live).
    if (host.includes('kryntal')) return 'https://megaplay.buzz/'
    if (host.includes('akirax') || host.includes('megaplay')) return 'https://megaplay.buzz/'
    if (host.includes('kwik') || host.includes('uwucdn')) return 'https://kwik.cx/'
    if (host.includes('mewstream')) return 'https://megaplay.buzz/'
    if (host.includes('anicrush') || host.includes('gniyonna')) return 'https://anicrush.to/'
    if (host.includes('vidwish')) return 'https://vidwish.live/'
    if (host.includes('24stream') || host.includes('fast4speed')) return 'https://anidap.lol/'
  } catch { /* fall through */ }
  return 'https://anidap.lol/'
}

/** Thin chad-API client. Returns parsed JSON on success, { _error: status }
 *  on an HTTP error (429 / 404 / 5xx), or null on a network failure/timeout.
 *  Callers can then tell "slug is gone" (404) from "chad hiccup" (null).
 *  timeoutMs defaults to 8s — the episodes endpoint serves up to ~1MB
 *  (long anime like One Piece have 1100+ eps) and needs a longer leash. */
async function chadGet(path, params = {}, timeoutMs = 8_000) {
  const qs = new URLSearchParams(params).toString()
  const url = `${CHAD_API}/${path}${qs ? `?${qs}` : ''}`
  await chadPace() // smooth the burst — see pacing block above
  try {
    const res = await fetch(url, { headers: CHAD_HEADERS, signal: AbortSignal.timeout(timeoutMs) })
    if (res.status === 429) {
      // chad rate-limits by IP — read the cooldown it tells us to respect
      // and set the site-wide window so every provider backs off together.
      let retryAfterMs = 60_000
      try {
        const body = await res.json()
        if (body && body.retry_after) retryAfterMs = Number(body.retry_after) || 60_000
      } catch { /* keep default */ }
      markChad429(retryAfterMs)
      return { _error: 429, retryAfterMs }
    }
    if (!res.ok) return { _error: res.status }
    return await res.json()
  } catch (e) {
    console.warn(`[anidap] chad ${path} fetch failed:`, e.message)
    return null // network failure — NOT a definitive answer
  }
}

// ── Resolve AniList ID -> metadata ───────────────────────────────────
// Fast path returns the REAL anidap text slug (embedded in the watch page
// SSR HTML) so the frontend can use it directly for all chad API calls.
// Falls back to a stub with the AniList ID as slug.
export async function getInfoByAniListId(anilistId) {
  const id = Number(anilistId)
  if (!id || isNaN(id)) throw Object.assign(new Error('Invalid AniList ID'), { upstream: 400 })

  try {
    const slug = await resolveAnidapSlug(id)
    if (slug) {
      return { slug, title: null, poster: null, totalEpisodes: null, anilistId: id, source: 'anidap' }
    }
  } catch { /* fall back to stub */ }

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
// Fast path: REAL episodes from the chad API (accurate counts, localized
// titles, dub/sub flags) instead of a 50-episode stub. Falls back to the
// stub when the slug can't be resolved (anime not on anidap).
// The full list is cached server-side (30 min) — it's a large payload for
// long anime (~1MB for 1100+ eps) and doesn't change between visits.
const episodesCache = new Map() // anilistId -> { at, episodes }
const EPISODES_CACHE_TTL = 30 * 60 * 1000

export async function getEpisodes(slug, anilistId, titles = {}) {
  const id = await resolveAnilistId(slug, anilistId, titles)
  if (!id) return []

  const cached = episodesCache.get(id)
  if (cached && Date.now() - cached.at < EPISODES_CACHE_TTL) return cached.episodes

  try {
    const resolved = await resolveAnidapSlug(id)
    if (resolved) {
      const list = await chadGet('episodes', { id: resolved }, 20_000)
      if (list?._error === 404) invalidateSlug(id)
      if (Array.isArray(list) && list.length > 0) {
        const eps = list.map((ep) => ({
          number: Number(ep.number) || 0,
          id: `${id}-${ep.number}`,
          title: ep.titles?.en || ep.titles?.['x-jat'] || ep.titles?.ja || '',
          hasDub: !!ep.hasDub,
          hasSub: !!ep.hasSub,
          img: ep.img || undefined,
        })).filter((ep) => ep.number > 0)
        if (eps.length > 0) {
          episodesCache.set(id, { at: Date.now(), episodes: eps })
          console.log(`[anidap] ✓ ${eps.length} real episodes for #${id}`)
          return eps
        }
      }
    }
  } catch (e) { console.warn(`[anidap] chad episodes failed for #${id}:`, e.message) }

  return Array.from({ length: 50 }, (_, i) => ({
    number: i + 1,
    id: `${id}-${i + 1}`,
  }))
}

function pruneEpisodesCache() {
  const now = Date.now()
  for (const [key, entry] of episodesCache) {
    if (now - entry.at > EPISODES_CACHE_TTL) episodesCache.delete(key)
  }
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
//
// The chad 'servers' response is cached per (anilistId, ep) for 5 min.
// Provider lists rarely change and this saves ~0.5-8s per new episode.
const providerListCache = new Map()
const PROVIDER_LIST_TTL = 5 * 60 * 1000
// Single-flight for concurrent getProviders() calls (see below).
const providerListInFlight = new Map() // cacheKey -> Promise<providers[]>
function pruneProviderListCache() {
  const now = Date.now()
  for (const [key, entry] of providerListCache) {
    if (now - entry.at > PROVIDER_LIST_TTL) providerListCache.delete(key)
  }
}

export async function getProviders(slug, ep, anilistId, titles = {}) {
  const id = await resolveAnilistId(slug, anilistId, titles)
  if (!id) return []

  // ── Provider-list cache: the list of servers for an episode changes
  // rarely. A 5-min TTL saves the ~0.5-8s chad API round-trip on every
  // episode-switch and app-restart, dramatically reducing "fetching servers"
  // spinner time for dub+sub users who see 2-3 rounds of this per episode.
  const cacheKey = `${id}:${Number(ep) || 1}`
  const cachedProviders = providerListCache.get(cacheKey)
  if (cachedProviders && Date.now() - cachedProviders.at < PROVIDER_LIST_TTL) {
    return cachedProviders.data
  }

  // ── Single-flight: the chad servers round-trip can take up to 8s when
  // chad is bot-blocked (the browser path is used inside getStream, but
  // the server LIST only has the fast path here). Two concurrent calls
  // (e.g. React StrictMode double-fetch + a stream request reading the
  // list) would both miss the cache and duplicate the work. Share one
  // promise instead.
  const inFlight = providerListInFlight.get(cacheKey)
  if (inFlight) return inFlight

  const attempt = (async () => {
    // Fast path: REAL per-episode provider lists from the chad API.
    // The site only lists servers that actually have this episode, so the
    // picker stops showing dead servers for episodes they don't cover.
    try {
      const resolved = await resolveAnidapSlug(id)
      if (resolved) {
        const data = await chadGet('servers', { id: resolved, epNum: Number(ep) || 1 })
        if (data?._error === 404) invalidateSlug(id)
        if (data && !data._error) {
          const out = []
          for (const [key, type] of [['subProviders', 'sub'], ['dubProviders', 'dub'], ['hsubProviders', 'hsub']]) {
            for (const p of data[key] || []) {
              out.push({ name: p.id, type, default: !!p.default, tip: p.tip || null })
            }
          }
          if (out.length > 0) {
            providerListCache.set(cacheKey, { at: Date.now(), data: out })
            return out
          }
        }
      }
    } catch (e) { console.warn(`[anidap] chad servers failed for #${id}:`, e.message) }

    // Chad is unreachable/bot-blocked. Fall back to the CURRENT Aug-2026
    // roster (1080p-capable names first — sora/kiwi/neko/beep), NOT the
    // legacy multi-CDN fleet. Returning the old dead names (nuri/kami/
    // koto/mochi/vee) made the picker full of "High Quality" tiles that
    // all failed, which is exactly the "servers are different" complaint.
    return [
      ...ALL_SUB_SERVERS.map(name => ({ name, type: 'sub', tip: PROVIDER_TIPS[name] || null })),
      ...ALL_DUB_SERVERS.map(name => ({ name, type: 'dub', tip: PROVIDER_TIPS[name] || null })),
      ...ALL_HSUB_SERVERS.map(name => ({ name, type: 'hsub', tip: PROVIDER_TIPS[name] || null })),
    ]
  })()

  providerListInFlight.set(cacheKey, attempt)
  try {
    return await attempt
  } finally {
    providerListInFlight.delete(cacheKey)
  }
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
  // ── BUT: verify the cached URL is still alive before serving it ──
  // The old behavior served the cached URL blindly for 10 min. When the
  // upstream link dies minutes after extraction (yuki/dub case: the uwu
  // host 404s the path right after signing), every later request got the
  // dead URL → 404 through /proxy → the player's error screen — and the
  // failure was CACHED too, so switching servers back to yuki kept
  // "working" and dying. A cheap master-probe through /proxy (same path
  // the player uses, ~1-2s, no browser work) catches this: on a definitive
  // 4xx we drop the cache entry and re-extract below.
  const cachedStream = streamCache.get(noStreamKey)
  if (cachedStream && Date.now() - cachedStream.at < STREAM_TTL) {
    const alive = await isCachedStreamAlive(cachedStream.data)
    if (alive) {
      console.log(`[anidap] Returning cached stream: ${id}:${epNum}/${bareProvider}/${type}`)
      return cachedStream.data
    }
    // ── Dead-cached-link decay ──
    // The cached link 4xx'd through /proxy (the same path the player uses).
    // SOME hosts do this every ~3rd request (otakuhg Cloudflare flapping:
    // live-verified 403-with-<html> vs 200 with #EXTM3U alternating within
    // seconds), so ONE probe failure shouldn't throw away a stream that has
    // been serving all day. Decay rule: 1st dead probe → keep the entry but
    // shrink its remaining TTL to 60s; a 2nd probe failure inside that
    // window → drop it for real and re-extract below.
    cachedStream.deadProbes = (cachedStream.deadProbes || 0) + 1
    if (cachedStream.deadProbes < 2) {
      cachedStream.at = Math.max(
        cachedStream.at,
        Date.now() - (STREAM_TTL - 60_000),
      )
      console.log(`[anidap] Cached stream flapped DEAD (probe ${cachedStream.deadProbes}) — keeping 60s grace: ${id}:${epNum}/${bareProvider}/${type}`)
      return cachedStream.data
    }
    console.log(`[anidap] Cached stream is DEAD (manifest 4xx ×${cachedStream.deadProbes}) — re-extracting: ${id}:${epNum}/${bareProvider}/${type}`)
    streamCache.delete(noStreamKey)
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

  // ── FAST PATH: chad REST API (browser-free) ──
  // The chad API moved to chad.anidap.lol/rest/api (the old api.anidap.lol
  // host is dead) and returns real sources over plain HTTP with just
  // Referer/Origin/UA — no browser, no cookies, no mutex. Once the slug is
  // cached this resolves in ~0.5-1.5s instead of the 10-30s DOM extraction.
  //
  // Hard block check FIRST: chad 403'd AND the browser path already proved
  // useless — fail fast (this request would only burn 2-6s on the browser
  // path and throw anyway). Stream-cache hits above are still served.
  if (isChadHardBlocked()) {
    throw Object.assign(
      new Error('AniDap upstream is temporarily blocking this connection (bot detection). Try again in a few minutes.'),
      { upstream: 503 },
    )
  }

  // Site-wide chad 429 (IP rate-limit): skip the fast path, the browser
  // path, AND the DOM fallback — they all hit the same blocked IP and each
  // would burn 8-18s before failing. Throw immediately so the router and
  // the client fail fast with the countdown the UI already renders.
  if (isChad429Blocked()) {
    const remainingSec = getChad429Remaining()
    throw Object.assign(
      new Error(`Anidap is temporarily rate-limited. Retry in ~${remainingSec}s.`),
      { upstream: 429, retryAfterSec: remainingSec },
    )
  }

  let chadSlug = null
  let chadFallbackNeeded = false // chad failed in a way the browser might recover (403 / network / 5xx)
  let browserPathThrew = false   // browser chad fetch threw at the network level (vs returned empty)

  // While chad is bot-blocking our IP, skip this path entirely — the 403
  // is site-wide, not per-provider, so we don't waste the route budget on
  // a call we know will fail.
  if (!isChadBlocked()) {
  try {
    const tFast = Date.now()
    chadSlug = await resolveAnidapSlug(id)
    if (chadSlug) {
      const data = await chadGet('sources', {
        id: chadSlug, epNum, type, providerId: bareProvider,
      })
      if (data?._error === 429) {
        // Throw (not return null) so the router labels this provider
        // rate-limited instead of "empty stream", and the post-race 429
        // check in the router surfaces the real status.
        markProviderRateLimited(bareProvider, RATE_LIMIT_COOLDOWN)
        throw Object.assign(new Error('too_many_requests'), { upstream: 429 })
      }
      if (data && Array.isArray(data.sources) && data.sources.length > 0) {
        const streamUrl = data.sources[0]?.url
        if (streamUrl) {
          // Skip streams whose manifest is an HTML error page — THROW a
          // transient error (NOT return null): a dead/expired CDN token is
          // not evidence the title lacks a stream. Returning null made the
          // router remember "no stream for this title" for 10 minutes and
          // every later request skipped instantly instead of re-extracting
          // a fresh token. The router cools the provider ~17s and falls
          // through; the NEXT request mints a fresh upstream token.
          if (!(await isRealVideoStream(streamUrl, data.headers))) {
            console.log(`[anidap] Skipping unusable stream (HTML error page): ${streamUrl.slice(0, 70)}`)
            throw Object.assign(new Error('unusable stream (HTML error page)'), { transient: true })
          }
          const tracks = (data.tracks || []).map((t) => ({
            file: t.url || t.file || '',
            label: t.label || '',
            kind: t.kind || 'captions',
            default: t.default || false,
            lang: t.lang || undefined,
          }))
          // Prefer the headers chad tells us to use (e.g. kryntal CDN needs
          // Referer: megaplay.buzz) — playerRefererFor is only a guess by
          // host and goes stale when anidap switches CDNs.
          const result = {
            url: streamUrl,
            raw: streamUrl,
            headers: data.headers && Object.keys(data.headers).length > 0
              ? data.headers
              : { Referer: playerRefererFor(streamUrl) },
            tracks: tracks.length > 0 ? tracks : null,
          }
          setStreamCache(noStreamKey, result)
          console.log(`[anidap] ✓ chad API stream: ${streamUrl.slice(0, 80)} (${Date.now() - tFast}ms)`)
          return result
        }
      }
      // chad returned no sources for this provider/ep.
      if (data === null) {
        // Network failure/timeout — the browser path may still succeed.
        chadFallbackNeeded = true
        console.log(`[anidap] chad network failure for ${id}:${epNum}/${bareProvider}/${type} - trying browser path`)
      } else if (data._error === 404) {
        // The slug is stale/gone (anidap regenerates random-suffix slugs) —
        // invalidate so the next request re-resolves instead of 404-looping
        // against the 12h cache. Short failure TTL too.
        invalidateSlug(id)
        setNoStream(noStreamKey, NO_STREAM_TTL_FAILURE)
        console.log(`[anidap] chad 404 for slug (invalidating): ${id}:${epNum}/${bareProvider}/${type}`)
        return null
      } else if (data._error === 403) {
        // bot_detected — the chad API is temporarily blocking our Node
        // fingerprint. NOT a per-provider failure: don't cache a no-stream
        // verdict and don't let the router cool down every provider. The
        // browser-cookie path below usually still works.
        markChadBlocked()
        chadFallbackNeeded = true
        console.log(`[anidap] chad bot_detected (403) for ${id}:${epNum}/${bareProvider}/${type} - trying browser path`)
      } else if (data && Array.isArray(data.sources) && data.sources.length === 0) {
        // chad CONFIRMED no sources for this provider/episode.
        setNoStream(noStreamKey, NO_STREAM_TTL_FAILURE)
        console.log(`[anidap] chad confirmed no sources for ${id}:${epNum}/${bareProvider}/${type}`)
        return null
      } else {
        // 5xx or unexpected shape — the browser may still get through.
        chadFallbackNeeded = true
        console.log(`[anidap] chad error for ${id}:${epNum}/${bareProvider}/${type}:`, data?._error || 'empty')
      }
    }
  } catch (fastErr) {
    // A 429 is site-wide (IP rate-limit): the browser path would hit the
    // same blocked IP and burn 2-6s before failing too. Re-throw so the
    // router surfaces it immediately — the client shows the countdown.
    if (fastErr?.upstream === 429 || fastErr?.message?.includes('too_many_requests')) {
      throw fastErr
    }
    console.warn(`[anidap] chad fast path failed for ${id}:${epNum}/${bareProvider}/${type}:`, fastErr.message)
  }
  }

  // ── Stream-URL normalization ──
  // Upstream hands us bare manifests with no playlist filename (live case:
  // `morning-credit-3bcc.vibevibe.workers.dev/ag5aaeb…` → 404; the real
  // master lives at `<same>/master.m3u8`). A 404 then flows straight to
  // the player → 30s spinner → error screen on EVERY server. Try the
  // documented suffixes and keep the first one that actually returns a
  // manifest. Cached per raw URL so each click doesn't re-probe.
  //
  // Probes go DIRECT to the CDN (with chad's Referer when provided) — a
  // bare-URL check only needs a 200, and the /proxy hop would double the
  // latency on the hot path.
  const urlNormalizeCache = new Map()
  const normalizeStreamUrl = async (rawUrl, headers) => {
    if (!rawUrl || /\.m3u8(\?|$)/i.test(rawUrl)) return rawUrl
    if (urlNormalizeCache.has(rawUrl)) return urlNormalizeCache.get(rawUrl)
    let resolved = rawUrl
    for (const suffix of ['/master.m3u8', '/index.m3u8', '/playlist.m3u8']) {
      try {
        const res = await fetch(`${rawUrl}${suffix}`, {
          headers: headers && Object.keys(headers).length ? headers : undefined,
          signal: AbortSignal.timeout(6_000),
        })
        if (res.ok) { resolved = `${rawUrl}${suffix}`; break }
      } catch { /* try next */ }
    }
    urlNormalizeCache.set(rawUrl, resolved)
    if (urlNormalizeCache.size > 500) urlNormalizeCache.clear()
    return resolved
  }

  // ── BROWSER CHAD PATH (cookies) ──
  // Plain Node fetch gets bot_detected (403) once the API fingerprints it;
  // the browser context with real anidap.lol cookies still returns real
  // sources (verified live). Runs when the Node fast path failed in a way
  // the browser might recover from (403 / network failure / 5xx).
  // Cost: ~2-6s (the browser is pre-warmed at startup).
  if (chadSlug && chadFallbackNeeded) {
    try {
      const tBrowser = Date.now()
      const browserData = await fetchChadSources(id, chadSlug, epNum, bareProvider, type)
      if (browserData && Array.isArray(browserData.sources) && browserData.sources.length > 0) {
        // Normalize FIRST: bare CDNs (vibevibe workers) hand back a path
        // with no playlist filename — probe the documented suffixes before
        // validating, or the manifest check 404s and the server is skipped.
        const normalizedUrl = await normalizeStreamUrl(browserData.sources[0]?.url, browserData.headers)
        if (normalizedUrl) {
          if (!(await isRealVideoStream(normalizedUrl, browserData.headers))) {
            setNoStream(noStreamKey, NO_STREAM_TTL_FAILURE)
            console.log(`[anidap] Skipping unusable browser stream (HTML error page): ${normalizedUrl.slice(0, 70)}`)
            // Transient (expired CDN token) — see the fast-path comment.
            throw Object.assign(new Error('unusable browser stream'), { transient: true })
          }
          const tracks = (browserData.tracks || []).map((t) => ({
            file: t.url || t.file || '',
            label: t.label || '',
            kind: t.kind || 'captions',
            default: t.default || false,
            lang: t.lang || undefined,
          }))
          const result = {
            url: normalizedUrl,
            raw: normalizedUrl,
            headers: browserData.headers && Object.keys(browserData.headers).length > 0
              ? browserData.headers
              : { Referer: playerRefererFor(normalizedUrl) },
            tracks: tracks.length > 0 ? tracks : null,
          }
          setStreamCache(noStreamKey, result)
          console.log(`[anidap] ✓ browser chad stream: ${normalizedUrl.slice(0, 80)} (${Date.now() - tBrowser}ms)`)
          return result
        }
      }
      console.log(`[anidap] browser chad returned no sources for ${id}:${epNum}/${bareProvider}/${type}`)
    } catch (browserErr) {
      // A 429 here is an IP rate-limit (site-wide, handled by markChad429),
      // NOT evidence of a bot block — don't let it contribute to the hard
      // block. Only network-level failures (fetch threw, 403, 5xx) do.
      const isBrowser429 = browserErr?.upstream === 429 || browserErr?.message?.includes('too_many_requests')
      if (!isBrowser429) browserPathThrew = true
      console.warn(`[anidap] browser chad path failed for ${id}:${epNum}/${bareProvider}/${type}:`, browserErr.message)
    }
  }

  // ── DOM extraction — browser fallback (chad API down / slug unknown) ──
  // ── SHORT-CIRCUIT: skip the DOM hop for combos upstream confirmed empty ──
  // getProviders is per-episode ground truth: if chad's server list doesn't
  // include this provider for this title/ep, the DOM page is a hard-404 SPA
  // ("HTTP error! status: 400 … If current server doesn't work try other
  // servers"). The old flow still burned a 16-20s browser extraction on it
  // (the 20s route cap → "sources 404 in 21s" loop). With the skip, the
  // route fails in <1s and the frontend falls through to the next server.
  // The chadSlug guard keeps gogoanime-style providers (no chad slug) on
  // the DOM path.
  //
  // ⚠ The provider list is cached under `${id}:${epNum}` where id is the
  // AniList id, BUT getProviders stores it under the key built from ITS
  // OWN resolved id which (for chad-backed lookups) equals the anilist id
  // too. However the FALLBACK roster path (chad unreachable) stores under
  // the same key — both share the shape. If neither key exists, we SKIP
  // the short-circuit rather than guess: an unknown list must not block a
  // provider that might be listed ("unknown" ≠ "dead").
  const providerListKey = providerListCache.has(`${id}:${epNum}`)
    ? `${id}:${epNum}`
    : (providerListCache.has(`${chadSlug}:${epNum}`) ? `${chadSlug}:${epNum}` : null)
  if (chadSlug && providerListKey) {
    const listed = providerListCache.get(providerListKey).data
    const hasThis = (Array.isArray(listed) ? listed : []).some(
      (p) => String(p.type) === String(type) &&
        String(p.name).toLowerCase() === String(bareProvider).toLowerCase(),
    )
    if (!hasThis) {
      console.log(`[anidap] Not listed for this title (per chad) — skipping DOM: ${id}:${epNum}/${bareProvider}/${type}`)
      setNoStream(noStreamKey, NO_STREAM_TTL_CONFIRMED)
      return null
    }
  }
  try {
    const tStart = Date.now()
    const watchUrl = `${BASE}/watch?id=${id}&ep=${epNum}&type=${type}&provider=${bareProvider}`
    console.log(`[anidap] DOM extraction: ${watchUrl.slice(0, 120)}`)
    const domData = await extractStreamFromWatchPage(watchUrl, { maxDurationMs: 18_000, signal: opts.signal })
    if (domData && Array.isArray(domData.sources) && domData.sources.length > 0) {
      // Same bare-URL normalization as the browser path (DOM extractions
      // also hand back filename-less vibevibe paths).
      const normalizedUrl = await normalizeStreamUrl(domData.sources[0]?.url, domData.headers)
      if (!normalizedUrl) {
        setNoStream(noStreamKey, NO_STREAM_TTL_CONFIRMED)
        return null
      }
      // Same fake-stream guard as the fast path (slideshow segments).
      if (!(await isRealVideoStream(normalizedUrl, domData.headers))) {
        setNoStream(noStreamKey, NO_STREAM_TTL_FAILURE)
        console.log(`[anidap] Skipping unusable DOM stream (HTML error page): ${normalizedUrl.slice(0, 70)}`)
        // Transient (expired CDN token) — see the fast-path comment.
        throw Object.assign(new Error('unusable DOM stream'), { transient: true })
      }
      const tracks = (domData.tracks || []).map((t) => ({
        file: t.url || t.file || '',
        label: t.label || '',
        kind: t.kind || 'captions',
        default: t.default || false,
      }))
      const result = {
        url: normalizedUrl,
        raw: normalizedUrl,
        headers: domData.headers && Object.keys(domData.headers).length > 0
          ? domData.headers
          : { Referer: watchUrl },
        tracks: tracks.length > 0 ? tracks : null,
      }
      setStreamCache(noStreamKey, result)
      console.log(`[anidap] ✓ DOM stream: ${normalizedUrl.slice(0, 80)} (${Date.now() - tStart}ms)`)
      return result
    }
    console.log(`[anidap] DOM returned no sources for ${id}:${epNum}/${bareProvider}/${type} (${Date.now() - tStart}ms)`)
    setNoStream(noStreamKey, NO_STREAM_TTL_CONFIRMED)
  } catch (domErr) {
    console.warn(`[anidap] DOM extraction failed for ${id}:${epNum}/${bareProvider}/${type}:`, domErr.message)
    // If chad was blocked AND the browser-cookie path THREW at the network
    // level (the block reached our browser too), the SPA couldn't render
    // the player — confirm the hard block so subsequent requests fail fast
    // instead of spinning. A browser path that merely returned EMPTY is a
    // per-provider no-stream answer and must NOT hard-block everything.
    // CRITICAL: an ABORTED extraction (the route cap or a race winner's
    // abort signal) is NOT a failure — it usually means ANOTHER provider
    // already won. Hard-blocking on an abort is the "fix one thing, break
    // everything" bug: one successful stream would fast-fail all of anidap
    // for 10 minutes. Aborts never confirm the block.
    // A mutex/Page TIMEOUT is NOT block evidence — under contention or a slow
    // Cloudflare challenge it happens constantly, and hard-blocking ALL of
    // anidap on it was the "every server says loading stream" bug. Only a
    // real render failure (navigation destroyed, challenge, HTTP error
    // panel) confirms the block reached our browser too. Both timeout
    // spellings are matched: 'Page operation timed out' (mutex) and
    // 'loadURL timeout' (navigation).
    const domWasAborted = domErr?.message?.includes('aborted') || domErr?.name === 'AbortError'
    const domIsTimeout = /timed out|timeout/i.test(domErr?.message || '')
    if (isChadBlocked() && browserPathThrew && !domWasAborted && !domIsTimeout) markChadHardBlocked()
    // Only mark rate-limited for actual 429s — not for timeouts or other errors
    if (domErr.upstream === 429 || domErr.message?.includes('too_many_requests')) {
      markProviderRateLimited(bareProvider, RATE_LIMIT_COOLDOWN)
    }
    // Transient errors: don't poison the cache (retry next time)
    if (!domIsTimeout && !domErr.message?.includes('challenge') && !domErr.message?.includes('aborted')) {
      setNoStream(noStreamKey, NO_STREAM_TTL_FAILURE)
    }
    // Abort / timeout / challenge are TRANSIENT — surface them as thrown
    // errors (marker: transient) so the router cools the provider briefly
    // but never records "this title has no stream". A mutex timeout says
    // nothing about upstream availability; poisoning on it locked users
    // out of working servers for the full 10-min TTL.
    if (domWasAborted || domIsTimeout || domErr.message?.includes('challenge')) {
      throw Object.assign(
        domErr instanceof Error ? domErr : new Error(String(domErr?.message || 'DOM extraction failed')),
        { transient: true },
      )
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
  pruneEpisodesCache()
  pruneProviderListCache()
}, 60_000).unref()

// ── Download (chad REST download API is dead) ────────────────────────
export async function getDownload(slug, ep, provider, type) {
  return null
}
