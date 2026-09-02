// server/health-check.js
//
// Terminal-friendly health checker for streaming servers.
//
// What it does
// ────────────
//   1. Probes each (provider, server, type) combo to confirm it can
//      produce a playable stream for a given anime + episode.
//   2. Caches results in-memory (success: 90s, fail: 30s) so we don't
//      hammer the upstream CDNs on every page load.
//   3. Logs a clean one-line ✅/❌ verdict per server to the terminal,
//      grouped by provider, with latencies and pass counts.
//   4. Optionally exposes filterDeadServers() so the /api/anidap/servers
//      route can mask out known-dead servers before sending them to the
//      browser (the user goal: "Display only working servers").
//
// Healtheck probe boundaries
// ──────────────────────────
//   We deliberately use `routedGetStream` rather than a HEAD-only
//   domain-liveness check. Why: stream CDNs frequently answer HEAD requests
//   fine while simultaneously failing on real m3u8 extraction (token,
//   Referer, or anti-bot mismatch). The real test is whether we can pull
//   a usable source URL out — that mirrors exactly what the player does.

import { routedGetStream, routedGetProviders } from './providers/router.js'
import { isRateLimited, getRateLimitRemaining, getAllKnownProviders, updateServerHealth } from './anidap.js'

// ── Cache config ──────────────────────────────────────────────────────
// Circuit breaker for upstream rate-limiting. When anidap starts
// returning 429s, back off health checks for 5 minutes so we don't keep
// hammering the upstream and starving real user requests.
let _rateLimitBackoffUntil = 0
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000

function isInRateLimitBackoff() {
  return Date.now() < _rateLimitBackoffUntil
}

export function markRateLimitBackoff() {
  _rateLimitBackoffUntil = Date.now() + RATE_LIMIT_BACKOFF_MS
}

const SUCCESS_TTL_MS = 90 * 1000       // 90s — healthy enough that repeating
                                      //        probes during one session are rare
const FAIL_TTL_MS    = 30 * 1000       // 30s — fail fast but allow quick recovery
const PROBE_TIMEOUT_MS = 12 * 1000     // default per-server probe cap
const PROBE_TIMEOUT_ANIDAP_MS = 15 * 1000  // 55s was far too long; 15s is enough
                                      // to know if a provider is cold-dead, and
                                      // avoids holding user requests hostage
                                      // (Chrome launch + Cloudflare + queue),
                                      // so 24s creates false negatives where
                                      // "down" servers actually resolve at
                                      // ~25-35s under load.
const MAX_CACHE_ENTRIES = 1000         // hard cap on healthCache size — prune
                                      // the oldest entries when exceeded so
                                      // long-lived servers don't leak memory
                                      // across many user sessions.

const healthCache = new Map()

// Prune oldest entries when the cache exceeds the cap. Called after every
// set() so memory stays bounded even with many users on different episodes.
function pruneHealthCacheIfNeeded() {
  if (healthCache.size <= MAX_CACHE_ENTRIES) return
  const drop = healthCache.size - MAX_CACHE_ENTRIES
  const toDrop = Array.from(healthCache.entries())
    .sort(([, a], [, b]) => a.at - b.at)
    .slice(0, drop)
  for (const [k] of toDrop) healthCache.delete(k)
}

/**
 * Cache key — stable across runs of the same episode. We deliberately
 * do NOT include `anilistId` because the resolved slug doesn't change
 * results; only the (slug, episode, provider, type) tuple matters.
 *
 *   key = `${slug}:${ep}:${provider}:${type}`
 */
function makeKey(slug, ep, provider, type) {
  return `${slug || '_'}:${ep || 0}:${provider}:${type}`
}

/**
 * Extract the provider family out of a (possibly-prefixed) server name.
 * e.g. "anidap-yuki" → "anidap", "saturn" → "saturn". We use this to
 * bind probes to the server's own provider family via ?source= so phase-3
 * cross-provider fallback in `routedGetStream` cannot mask provider-
 * specific outages (e.g. anidap-yuki returning a saturn URL and being
 * cached as "ok" when anidap is actually down).
 *
 * Must align with the actual `name` exports of provider modules:
 *   anidap.js   → 'anidap'  (only surviving provider as of Jun 2026)
 */
function providerFamily(name) {
  if (!name) return null
  const lower = String(name).toLowerCase()
  if (lower === 'anidap') {
    return lower
  }
  return name.split('-')[0].toLowerCase()
}

/**
 * Attempt to extract a stream URL out of (provider, slug, ep, type).
 * Uses the SAME `routedGetStream` call the player uses — so "healthy"
 * really means "the player will be able to play this".
 *
 * Crucially, we bind the probe to the SERVER'S OWN PROVIDER FAMILY via
 * ?source=. This stops phase-3 cross-provider fallback from masking a
 * provider-specific outage — see providerFamily() above.
 *
 * @returns {Promise<{ ok: boolean, ms: number, url?: string, error?: string }>}
 */
export async function probeServer({ slug, ep, provider, type, anilistId = null, signal = null }) {
  // Skip blank inputs early — they would just hammer the router with garbage.
  if (!provider || !type) {
    return { ok: false, ms: 0, error: 'missing provider or type' }
  }

  // Skip anidap probes during rate-limit cooldown or circuit-breaker backoff.
  // Probing during cooldown guarantees failure (429 + "cooldown Xs remaining")
  // and wastes cf-harvester queue slots. The health cache TTL (30s for failures)
  // means previously healthy anidap servers stay cached while we wait.
  if (providerFamily(provider) === 'anidap' && (isRateLimited() || isInRateLimitBackoff())) {
    return { ok: false, ms: 0, error: `rate-limited, cooldown ${getRateLimitRemaining()}s remaining` }
  }

  // Use doubled timeout for anidap — its Puppeteer queue serialises
  // calls so each probe waits for predecessors before starting.
  const family = providerFamily(provider)
  const capMs = family === 'anidap' ? PROBE_TIMEOUT_ANIDAP_MS : PROBE_TIMEOUT_MS

  const start = Date.now()
  // We don't actually thread AbortController to routedGetStream — the
  // provider modules don't accept signals — so we just cap the wall-clock
  // for the verdict. The upstream axios call may continue briefly past
  // the cap but races against our time budget via Promise.race, so worst
  // case the verdict is "timeout" while the upstream finishes naturally
  // (socket is released when upstream is finished).
  let timedOut = false
  try {
    // Bind the probe to the server's own provider family so phase-3
    // cross-provider fallback doesn't mask provider-specific failures.
    const query = family ? { source: family } : {}
    const data = await Promise.race([
      routedGetStream(anilistId, slug, Number(ep) || 1, provider, type, query),
      new Promise((_, reject) =>
        setTimeout(() => {
          timedOut = true
          reject(Object.assign(new Error('Probe timeout'), { probeTimeout: true }))
        }, capMs),
      ),
    ])
    const ms = Date.now() - start
    if (data && (data.url || data.raw)) {
      // If the router's cross-provider fallback (phase 3) handed us a
      // stream from a different provider, still report the server as
      // reachable — the user can actually play it. The frontend uses
      // _healthError to show a note but keeps the server clickable.
      const returnedSource = (data.source || '').toLowerCase()
      const safeFamily = (family || '').toLowerCase()
      const crossProvider = safeFamily && returnedSource && returnedSource !== safeFamily
      const verdict = { ok: true, ms, url: data.url || data.raw }
      if (crossProvider) {
        verdict._crossProvider = true
        verdict._crossProviderNote = `resolved via ${returnedSource} (not ${safeFamily})`
      }
      return verdict
    }
    return { ok: false, ms, error: 'no stream url returned' }
  } catch (e) {
    const msg = (timedOut ? 'probe timeout' : (e?.message || String(e) || 'unknown')).slice(0, 160)
    // Trip the circuit breaker on any 429 / too_many_requests so we stop
    // hammering the upstream and give real user requests a chance.
    if (e?.upstream === 429 || (typeof msg === 'string' && msg.includes('429')) || (typeof msg === 'string' && msg.includes('too_many_requests'))) {
      markRateLimitBackoff()
    }
    return {
      ok: false,
      ms: Date.now() - start,
      error: msg,
    }
  }
}

/**
 * Read a cache entry. Returns { ok, ... } when fresh, or null when
 * stale/missing.
 */
export function getCachedHealth(slug, ep, provider, type) {
  const key = makeKey(slug, ep, provider, type)
  const entry = healthCache.get(key)
  if (!entry) return null
  const ttl = entry.ok ? SUCCESS_TTL_MS : FAIL_TTL_MS
  if (Date.now() - entry.at > ttl) {
    healthCache.delete(key)
    return null
  }
  return entry
}

/**
 * Probe every server for a given (slug, ep). Returns a list of all
 * verdicts plus a `working` array sorted by latency. Caches each result.
 *
 * @param {object} opts
 * @param {string}   opts.slug
 * @param {number}   opts.ep
 * @param {number?}  opts.anilistId
 * @param {number}   opts.max    cap to keep probes cheap (default 8)
 */
export async function runHealthCheck({ slug, ep, anilistId = null, max = 8 } = {}) {
  // Cap parallelism to avoid overwhelming the proxy event loop.
  // 8 simultaneous probes with long timeouts can saturate the
  // Express keep-alive pool and starve real client requests.
  const { providers } = await routedGetProviders(anilistId, slug, Number(ep)).catch(() => ({ providers: [] }))
  if (!providers?.length) return { results: [], working: [], dead: [], all: 0 }

  const toProbe = providers.slice(0, max)
  const anidapOnly = toProbe.length > 0 && toProbe.every((p) => providerFamily(p.name) === 'anidap')
  // Anidap-only runs can thrash Puppeteer startup/queue when launched in
  // parallel, which manifests as false "probe timeout" errors on good servers.
  const maxParallel = anidapOnly ? 1 : Math.min(max, 3)

  // Prime Puppeteer/Cloudflare once before collecting scored probe results.
  // Without this warm-up, the first measured server can time out purely from
  // cold-start overhead and be incorrectly marked dead.
  if (anidapOnly && toProbe[0]) {
    try {
      await probeServer({
        slug,
        ep,
        provider: toProbe[0].name,
        type: toProbe[0].type,
        anilistId,
      })
    } catch {
      // Warm-up probe is best-effort only.
    }
  }

  // Batch probes at most 3 concurrent to avoid saturating the event loop.
  const settled = []
  for (let i = 0; i < toProbe.length; i += maxParallel) {
    const batch = toProbe.slice(i, i + maxParallel)
    const batchResults = await Promise.allSettled(
      batch.map(async (p) => {
        const verdict = await probeServer({
          slug, ep, provider: p.name, type: p.type, anilistId,
        })
        const key = makeKey(slug, ep, p.name, p.type)
        healthCache.set(key, { at: Date.now(), ...verdict })
        pruneHealthCacheIfNeeded()
        return { ...verdict, name: p.name, type: p.type, key }
      }),
    )
    settled.push(...batchResults)
  }

  const results = settled.map((s) =>
    s.status === 'fulfilled' ? s.value : { ok: false, ms: 0, name: '?', type: '?', error: 'rejected', key: '?' },
  )

  const working = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)
  const dead    = results.filter((r) => !r.ok)

  return { results, working, dead, all: results.length }
}

/**
 * Annotate a provider list with health status without filtering.
 * Returns the original list with `_healthy`, `_healthMs`, `_healthError`
 * fields added to each entry.
 *
 * The frontend uses these fields to render dead servers grayed out
 * with an offline badge — servers are NEVER hidden, only flagged.
 */
export async function annotateHealth({ providers, slug, ep, anilistId = null } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) return providers

  const cached = []
  const needProbe = []
  for (const p of providers) {
    const hit = getCachedHealth(slug, ep, p.name, p.type)
    if (hit) cached.push({ p, hit })
    else     needProbe.push(p)
  }

  // Probe the unknowns in parallel
  if (needProbe.length) {
    const verdicts = await Promise.all(
      needProbe.map(async (p) => {
        const v = await probeServer({ slug, ep, provider: p.name, type: p.type, anilistId })
        const key = makeKey(slug, ep, p.name, p.type)
        healthCache.set(key, { at: Date.now(), ...v })
        pruneHealthCacheIfNeeded()
        return { p, hit: v }
      }),
    )
    cached.push(...verdicts)
  }

  // Annotate every provider with health info — never drop it
  return providers.map((p) => {
    const hit = cached.find(({ p: cp }) => cp.name === p.name && cp.type === p.type)?.hit
    return {
      ...p,
      _healthy: hit?.ok === true,
      _healthMs: hit?.ms ?? null,
      _healthError: hit?.ok === false ? (hit.error || 'unknown') : null,
      _crossProvider: hit?._crossProvider === true ? true : undefined,
      _crossProviderNote: hit?._crossProviderNote || undefined,
    }
  })
}

/**
 * Filter the provider list as returned by `routedGetProviders` so the
 * frontend only sees working servers. We use the cache first, fall back
 * to a quick inline probe per provider if no cache exists.
 *
 * If *every* probe fails (network down, very first request), we return
 * the original list untouched rather than empty — better UX than
 * "no servers" when we just haven't probed yet.
 *
 * DEPRECATED: use annotateHealth() instead — the no-hide policy means
 * we show all servers and flag dead ones rather than dropping them.
 */
export async function filterDeadServers({ providers, slug, ep, anilistId = null } = {}) {
  if (!Array.isArray(providers) || providers.length === 0) return providers

  const cached = []
  const needProbe = []
  for (const p of providers) {
    const hit = getCachedHealth(slug, ep, p.name, p.type)
    if (hit) cached.push({ p, hit })
    else     needProbe.push(p)
  }

  // Probe the unknowns in parallel (capped, time-budget friendly).
  if (needProbe.length) {
    const verdicts = await Promise.all(
      needProbe.map(async (p) => {
        const v = await probeServer({ slug, ep, provider: p.name, type: p.type, anilistId })
        const key = makeKey(slug, ep, p.name, p.type)
        healthCache.set(key, { at: Date.now(), ...v })
        pruneHealthCacheIfNeeded()
        return { p, hit: v }
      }),
    )
    cached.push(...verdicts)
  }

  // If nothing probed successfully, fall through with original list —
  // we don't want to accidentally show empty server pickers when our
  // own probes failed (network issue) rather than the source being dead.
  const anyOk = cached.some(({ hit }) => hit?.ok)
  if (!anyOk) return providers

  // Prefer fresh-cache ordering when both have the same ok-status —
  // gives the frontend a stable list across re-renders.
  return providers.filter((p) => {
    const hit = cached.find(({ p: cp }) => cp.name === p.name && cp.type === p.type)?.hit
    return hit?.ok === true
  })
}

// ── Terminal output ──────────────────────────────────────────────────

const SYMBOL_OK  = '\x1b[32m✓\x1b[0m'   // green tick
const SYMBOL_BAD = '\x1b[31m✗\x1b[0m'   // red cross
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

/**
 * Pretty-print a single health-check result to the terminal.
 * Groups by provider family so a long list is easy to skim.
 */
export function logHealthCheck({ slug, ep, results }) {
  if (!results || !results.length) {
    console.log(`${DIM}[health-check]${RESET} no providers to probe for ${slug}:${ep}`)
    return
  }

  // Group by provider-family (everything before the dash)
  const groups = {}
  for (const r of results) {
    const family = (r.name || '?').split('-')[0] || 'unknown'
    groups[family] ||= []
    groups[family].push(r)
  }

  const okCount  = results.filter((r) => r.ok).length
  const failCount = results.length - okCount
  const avgOkMs  = okCount
    ? Math.round(results.filter((r) => r.ok).reduce((s, r) => s + r.ms, 0) / okCount)
    : 0

  console.log('')
  console.log(`${BOLD}[health-check]${RESET} ${slug}:ep${ep}  ` +
    `${SYMBOL_OK} ${okCount} ok · ${SYMBOL_BAD} ${failCount} down · ${DIM}avg ${avgOkMs}ms${RESET}`)
  for (const [family, items] of Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`${DIM}  └─ ${family}${RESET}`)
    for (const r of items) {
      const sym = r.ok ? SYMBOL_OK : SYMBOL_BAD
      const cleanName = r.name.replace(/^anidap-/i, '')
      const status = r.ok ? `${DIM}${r.ms}ms${RESET}` : `${DIM}${r.error || 'fail'}${RESET}`
      console.log(`${DIM}     ${sym}${RESET} ${cleanName.padEnd(14)} ${r.type.padEnd(4)} ${status}`)
    }
  }
}

// ──  Server-level health probe ────────────────────────────────────────
//
// Probes ALL known anidap servers (not just the ones from getProviders)
// against a reliable anime (One Piece ep 1) so we know which servers are
// generally reachable. Results feed into anidap.js's serverHealthCache,
// which getProviders() uses to dynamically enable/disable servers.
//
// Runs every scheduler tick (15 min). Probes serially because
// cf-harvester uses a single shared browser page — parallel probes
// would navigate the page away from each other.

export async function probeAllServersHealth() {
  // ── Skip probing while chad is bot-blocked / 429'd ──
  // The scheduler's serial DOM probes against a dead upstream take 8-15s
  // EACH (12+ servers ≈ 2.5+ min of mutex time) and mark healthy servers
  // "unreachable" — exactly the "all servers down" false state. The probes
  // can't distinguish upstream blockage from a dead server; deferring is
  // strictly better. chad gates auto-clear (5 min soft / ≤3 min 429), and
  // the scheduler fires again on its next tick (default 15 min).
  const { isChadBlocked, isChad429Blocked } = await import('./anidap.js')
  if (isChadBlocked() || isChad429Blocked()) {
    console.log('[health-check] chad is blocked — skipping server probe this tick')
    return
  }

  const providers = getAllKnownProviders()
  if (!providers?.length) return

  // Probe SERIALLY — not in parallel. cf-harvester.js uses a single
  // shared browser page for DOM extraction. Parallel probes would
  // navigate the page away from each other, causing net::ERR_ABORTED.
  let ok = 0
  let dead = 0

  for (const p of providers) {
    const verdict = await probeServer({
      slug: '21',  // One Piece — reliable, always available
      ep: 1,
      provider: `anidap-${p.name}`,
      type: p.type,
      anilistId: 21,
    })
    updateServerHealth(p.name, p.type, verdict.ok)
    if (verdict.ok) ok++
    else dead++
  }

  console.log(`${DIM}[health-check]${RESET} server health probe done: ${SYMBOL_OK} ${ok} ok · ${SYMBOL_BAD} ${dead} down (${providers.length} total)`)
}

// ── Periodic background scheduler ──────────────────────────────────────
//
// On a 15-minute cadence, probe a small rotation of popular anime so the
// cache is warm before the user even asks. This is intentionally cheap
// (2 shows, each ~4 servers) — we're not trying to enumerate every
// anime; we just want statistical confidence that the providers are up
// and not slowly rotting. Reduced from 4 shows/5min to 2 shows/15min
// after anidap.se rate-limiting (429) was triggered by the previous
// aggressive probing cadence.

const POPULAR_ANIME = [
  { anilistId: 21,    name: 'One Piece' },     // long-running, lots of eps
  { anilistId: 113415, name: 'Jujutsu Kaisen' },
]

let schedulerHandle = null
let _schedulerStopped = false

/**
 * Start the background scheduler. Safe to call multiple times — only one
 * loop will run at a time. Set SCHED_DISABLED=1 to disable entirely.
 */
export function startHealthCheckScheduler({ intervalMs = 15 * 60 * 1000 } = {}) {
  if (schedulerHandle) return // already running
  if (process.env.SCHED_DISABLED === '1') {
    console.log(`${DIM}[health-check]${RESET} scheduler disabled via SCHED_DISABLED=1`)
    return
  }

  _schedulerStopped = false

  // Add ±30s jitter to the interval so probes don't hit at the exact
  // same wall-clock time every cycle (avoids predictable traffic patterns
  // that Cloudflare rate-limiters can latch onto).
  const jitteredInterval = () => {
    const jitter = (Math.random() - 0.5) * 60_000  // ±30s
    return intervalMs + jitter
  }

  let nextInterval = jitteredInterval()

const tick = async () => {
    // ── Skip the whole tick while chad is blocked (ROOT FIX) ──
    // The per-title loop below fires routedGetProviders + stream probes;
    // during a chad 429 window those calls re-trip the IP limiter and
    // EXTEND the lockout indefinitely ("backing off 180s" on a loop),
    // which is how one cold anime kept the whole API locked out. The
    // gates inside probeAllServersHealth aren't enough — check once here.
    try {
      const { isChadBlocked, isChad429Blocked } = await import('./anidap.js')
      if (isChadBlocked() || isChad429Blocked()) {
        console.log(`${DIM}[health-check]${RESET} chad is blocked — skipping this tick entirely`)
        return
      }
    } catch { /* fall through and probe as usual */ }

    // ── Server-level health: probe ALL known anidap servers against
    // One Piece ep 1 so getProviders() can dynamically enable servers
    // that come back online (and disable ones that go down). ──
    console.log(`${DIM}[health-check]${RESET} scheduler tick — probing all known anidap servers…`)
    await probeAllServersHealth()

    console.log(`${DIM}[health-check]${RESET} probing ${POPULAR_ANIME.length} popular titles for per-episode cache…`)
    for (const show of POPULAR_ANIME) {
      try {
        // Use ep=1 because every show has it — cheaper than resolving actual counts.
        const { results } = await runHealthCheck({
          slug: String(show.anilistId), ep: 1, anilistId: show.anilistId, max: 4,
        })
        logHealthCheck({ slug: show.name, ep: 1, results })
      } catch (e) {
        console.warn(`${DIM}[health-check]${RESET} scheduler tick failed for ${show.name}:`, e?.message || e)
      }
      // 5s gap between shows so burst traffic doesn't overwhelm the
      // cf-harvester queue (which serialises all anidap requests through
      // a single browser page). Without this gap, 2 shows × 4 providers
      // = 8 probes hit the queue in rapid succession. Increased from 2s
      // to 5s after anidap.se 429 rate-limiting.
      await new Promise(r => setTimeout(r, 5000))
    }
  }

  // Skip the boot-time probe. The scheduler already runs every 15 minutes;
  // probing immediately after boot just hammers upstream CDNs while the user
  // is most likely opening the app for the first time. The first scheduled
  // tick will warm the cache soon enough.
  // (Previously a 30s boot probe was here; it caused rate-limit 429s on startup.)

  const scheduleNext = () => {
    if (_schedulerStopped) return
    nextInterval = jitteredInterval()
    schedulerHandle = setTimeout(() => {
      tick().catch((e) => console.warn('[health-check] scheduled tick failed:', e?.message || e))
      scheduleNext()
    }, nextInterval)
    // Don't keep the event loop alive just for the scheduler — let the
    // process exit cleanly when the rest of the server is shut down.
    if (typeof schedulerHandle.unref === 'function') schedulerHandle.unref()
  }
  scheduleNext()
  console.log(`${DIM}[health-check]${RESET} scheduler started (every ${Math.round(intervalMs / 60_000)}m)`)
}

export function stopHealthCheckScheduler() {
  _schedulerStopped = true
  if (!schedulerHandle) return
  clearTimeout(schedulerHandle)
  schedulerHandle = null
}

/**
 * Reset the cache — used by the CLI script (so each run starts fresh)
 * and by an admin endpoint if we ever add one.
 */
export function clearHealthCache() {
  return healthCache.clear()
}

/**
 * Stats snapshot — useful for the /api/health/servers endpoint.
 * Returns: total entries, ok count, dead count, oldest age (ms).
 */
export function getHealthStats() {
  let ok = 0, dead = 0, oldest = 0
  const now = Date.now()
  for (const [, v] of healthCache) {
    if (v.ok) ok++; else dead++
    if (now - v.at > oldest) oldest = now - v.at
  }
  return { total: healthCache.size, ok, dead, oldestAgeMs: oldest }
}

/**
 * Recent cache entries (newest-first, snapshot of the underlying Map).
 * Exposed for /api/health/servers so ops can see what we have on hand.
 */
export function getRecentHealthEntries(limit = 50) {
  return Array.from(healthCache.entries())
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, limit)
}
