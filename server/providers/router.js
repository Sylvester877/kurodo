// Provider router — Jul 2026.
//
// The current runtime ships only the anidap provider. Keep this thin router
// layer so additional providers can be plugged back in without changing route
// handlers, but never fabricate fallback providers that don't exist.

import { anidapProvider } from './anidap.js'
import { gogoanimeProvider } from './gogoanime.js'
import { megavidProvider } from './megavid.js'
import {
  isProviderRateLimited, markProviderRateLimited,
  isChadBlocked, isChad429Blocked, getChad429Remaining,
} from '../anidap.js'

const IS_ELECTRON = typeof process !== 'undefined' && process.type === 'browser'

// Fastest-known providers ordered by speed (from Naruto/JJK benchmarks).
// Used as the racing pool — the user's provider races these 4 in parallel.
const FAST_PROVIDERS = ['anidap-yuki','anidap-kami','anidap-neko','anidap-koto']

// Per-provider failure cooldown across requests. When a provider fails to
// return a stream (empty, timeout, or exception), it is briefly cooled down
// so the next request doesn't waste time on a dead/slow provider. Consecutive
// failures back off exponentially up to a cap. A successful stream clears it.
const providerFailureCooldown = new Map()
const FAILURE_COOLDOWN_BASE_MS = 15_000
const FAILURE_COOLDOWN_MAX_MS = 120_000
const FAILURE_COOLDOWN_JITTER_MS = 5_000
// ── Title-aware dead-link skipping ──────────────────────────────────
// A provider that returned NOTHING for a specific title used to only be
// skipped by its GLOBAL failure cooldown (15s→120s exponential). Two
// problems: (a) the global cooldown blocks that provider for OTHER titles
// where it works fine, and (b) after the cooldown expires, the SAME dead
// title+provider combo is re-raced — burning another 20-25s route budget
// on a server that upstream has already confirmed has nothing. The
// negative cache is per (title, provider, type) with a 10-min TTL, so
// "kiwi has no dub for this movie" is remembered per-title instead of
// poisoning every title.
const titleNoStreamCache = new Map() // `${slugOrId}:${ep}:${provider}:${type}` -> untilMs
const TITLE_NO_STREAM_TTL = 10 * 60 * 1000

function isTitleNoStream(anilistId, slug, ep, provider, type) {
  const key = `${slug || anilistId || ''}:${ep}:${provider}:${type}`
  const until = titleNoStreamCache.get(key)
  if (!until) return false
  if (Date.now() >= until) {
    titleNoStreamCache.delete(key)
    return false
  }
  return true
}

function markTitleNoStream(anilistId, slug, ep, provider, type) {
  if (!provider) return
  const key = `${slug || anilistId || ''}:${ep}:${provider}:${type}`
  titleNoStreamCache.set(key, Date.now() + TITLE_NO_STREAM_TTL)
  if (titleNoStreamCache.size > 500) {
    const now = Date.now()
    for (const [k, until] of titleNoStreamCache) if (now >= until) titleNoStreamCache.delete(k)
    if (titleNoStreamCache.size > 500) {
      const firstKey = titleNoStreamCache.keys().next().value
      if (firstKey !== undefined) titleNoStreamCache.delete(firstKey)
    }
  }
}

function isProviderInCooldown(provider) {
  const entry = providerFailureCooldown.get(provider)
  if (!entry) return false
  if (Date.now() >= entry.until) {
    providerFailureCooldown.delete(provider)
    return false
  }
  return true
}

function markProviderCooldown(provider, reason) {
  if (!provider) return
  const existing = providerFailureCooldown.get(provider)
  const multiplier = existing ? existing.multiplier * 2 : 1
  const delay = Math.min(FAILURE_COOLDOWN_BASE_MS * multiplier, FAILURE_COOLDOWN_MAX_MS)
  const jitter = Math.floor(Math.random() * FAILURE_COOLDOWN_JITTER_MS)
  providerFailureCooldown.set(provider, {
    until: Date.now() + delay + jitter,
    multiplier,
    reason,
  })
  if (providerFailureCooldown.size > 100) {
    pruneProviderCooldown()
    if (providerFailureCooldown.size > 100) {
      let oldest = null
      for (const [name, entry] of providerFailureCooldown) {
        if (!oldest || entry.until < oldest.entry.until) oldest = { name, entry }
      }
      if (oldest) providerFailureCooldown.delete(oldest.name)
    }
  }
  console.log(`[router] Provider ${provider} cooled down for ${Math.round((delay + jitter) / 1000)}s (${reason})`)
}

function clearProviderCooldown(provider) {
  providerFailureCooldown.delete(provider)
}

// 3-slot semaphore matching the cf-harvester page-pool size: at most this
// many candidates extract concurrently; the rest queue in FIFO order and
// start the moment a slot frees. Fast candidates (cache/chad fast path)
// never queue meaningfully.
function createSlotLimiter(n) {
  let active = 0
  const waiters = []
  return async function run(fn) {
    if (active >= n) await new Promise((r) => waiters.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiters.shift()?.()
    }
  }
}
const candidateSlot = createSlotLimiter(2)

function bareProviderName(name) {
  return name.replace(/^anidap-/, '')
}

function isProviderRateLimitedAny(name) {
  return isProviderRateLimited(name) || isProviderRateLimited(bareProviderName(name))
}

function shouldSkipProvider(name) {
  return isProviderRateLimitedAny(name) || isProviderInCooldown(name)
}

function pruneProviderCooldown() {
  const now = Date.now()
  for (const [provider, entry] of providerFailureCooldown) {
    if (now >= entry.until) providerFailureCooldown.delete(provider)
  }
}

function normalizeProviderName(providerName) {
  if (!providerName) return providerName
  if (/^anidap-/i.test(providerName)) return providerName
  if (/^gogoanime-/i.test(providerName)) return providerName
  return `anidap-${providerName}`
}

export async function routedGetInfo(anilistId) {
  try {
    const info = await anidapProvider.getInfoByAniListId(anilistId)
    if (info?.slug) return { ...info, source: 'anidap' }
  } catch {
    // fall through to gogoanime
  }

  try {
    const gogoInfo = await Promise.race([
      gogoanimeProvider.getInfoByAniListId(anilistId),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('gogoanime info timeout')), 4000),
      ),
    ])
    if (gogoInfo?.slug) return { ...gogoInfo, source: 'gogoanime' }
  } catch { /* fall through */ }

  return { slug: String(anilistId), anilistId, source: 'anidap' }
}

export async function routedGetEpisodes(anilistId, slug, title) {
  // Always try anidap — episodes are a stub, never rate-limited
  try {
    const episodes = await anidapProvider.getEpisodes(slug || String(anilistId), anilistId, title)
    if (episodes && episodes.length > 0) {
      return { episodes, source: 'anidap', unavailable: false }
    }
  } catch { /* fall through */ }

  // Fall back to gogoanime for episode lists with real thumbnails
  try {
    const gogoEps = await gogoanimeProvider.getEpisodes(slug, anilistId)
    if (gogoEps && gogoEps.length > 0) {
      return { episodes: gogoEps, source: 'gogoanime', unavailable: false }
    }
  } catch { /* fall through */ }

  return { episodes: [], source: null, unavailable: true, reason: 'provider-error' }
}

export async function routedGetProviders(anilistId, slug, ep, title) {
  const allProviders = []

  // While chad is site-wide blocked, gogoanime is the only live door.
  // Its AniList→slug search takes ~12s cold — do it NOW in the background
  // (when the watch page loads) so the user's first play click finds the
  // slug warm in cache instead of timing out mid-failover.
  if (isChad429Blocked() && anilistId) {
    gogoanimeProvider.getInfoByAniListId(anilistId).catch(() => {})
  }

  // Always return all anidap servers — no rate-limit gate here.
  // Individual servers may be rate-limited, but the LIST should always
  // show so the user can see what's available and try different servers.
  try {
    const providers = await anidapProvider.getProviders(slug || String(anilistId), ep, anilistId, title)
    if (Array.isArray(providers)) {
      allProviders.push(...providers.map((s) => ({ ...s, _provider: 'anidap' })))
    }
  } catch { /* continue */ }

  // Then gogoanime as fallback (Electron mode only)
  if (IS_ELECTRON) {
    try {
      const gogoProviders = await gogoanimeProvider.getProviders(slug, ep, anilistId)
      if (Array.isArray(gogoProviders)) {
        allProviders.push(...gogoProviders.map((s) => ({ ...s, _provider: 'gogoanime' })))
      }
    } catch { /* continue */ }
  }

  if (allProviders.length > 0) {
    return { providers: allProviders, source: 'gogoanime+anidap', unavailable: false }
  }

  return {
    providers: [],
    source: null,
    unavailable: true,
    reason: 'provider-error',
  }
}

export async function routedGetStream(anilistId, slug, ep, providerName, type, _query, title, signal) {
  const normalized = normalizeProviderName(providerName)
  const effectiveSlug = slug || String(anilistId || '')
  const tried = new Set()

  // Site-wide chad 429 (IP rate-limit): every anidap provider will 429
  // together, and each would otherwise burn seconds in the race pool before
  // failing. Gogoanime does NOT use chad, so we FAIL OVER to it instead of
  // dead-ending: the user asked for a stream, chad is temporarily blocked,
  // give them gogoanime (a separate scraper) so playback still works. Only
  // surface the 429 countdown if gogoanime ALSO fails. An explicit
  // gogoanime- server pick is already gogoanime — let it through.
  // ── megavid first-resort fast path (root fix for chad rate-limiting) ──
  // megavid.buzz is MAL-keyed, plain HTTP (~2s), browser-free, and 100%
  // chad-independent — verified working even while chad 429s our IP. Racing
  // it FIRST means most requests resolve before touching chad at all:
  // fewer chad calls → less rate-limit pressure → fewer 429 windows.
  // An explicit gogoanime- pick keeps its dedicated path below.
  if (!providerName?.startsWith('gogoanime-') && !providerName?.startsWith('megavid')) {
    try {
      const megavidData = await Promise.race([
        megavidProvider.getStream(anilistId, ep, type, title, { signal, malId: _query?.malId }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('megavid timeout')), 20_000),
        ),
      ])
      if (megavidData) {
        console.log(`[router] megavid fast path won for #${anilistId} ep${ep} ${type}`)
        return { ...megavidData, source: 'megavid' }
      }
    } catch (e) {
      console.warn(`[router] megavid fast path failed: ${e?.message || e}`)
    }
  }

  const chad429Sec = isChad429Blocked() ? getChad429Remaining() : 0
  if (chad429Sec > 0 && !providerName?.startsWith('gogoanime-')) {
    console.warn(`[router] chad site-wide rate-limit — trying gogoanime fallback (~${chad429Sec}s remaining)`)
    try {
      const gogoInfo = await Promise.race([
        gogoanimeProvider.getInfoByAniListId(anilistId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('gogoanime info timeout')), 15_000),
        ),
      ])
      if (gogoInfo?.slug) {
        const gogoProvider = type === 'dub' ? 'gogoanime-dub' : 'gogoanime-sub'
        const gogoData = await Promise.race([
          gogoanimeProvider.getStream(gogoInfo.slug, ep, gogoProvider, type, anilistId, { signal }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('gogoanime stream timeout')), 30_000),
          ),
        ])
        if (gogoData) {
          console.log(`[router] Gogoanime fallback succeeded for #${anilistId} (chad was rate-limited)`)
          return { ...gogoData, source: 'gogoanime' }
        }
      }
    } catch (e) {
      console.warn(`[router] gogoanime fallback (chad 429) failed: ${e?.message || e}`)
    }
    // Both chad (blocked) and gogoanime (failed) — now surface the countdown.
    const err = new Error(`Anidap is temporarily rate-limited. Retry in ~${chad429Sec}s.`)
    err.upstream = 429
    err.retryAfterSec = chad429Sec
    throw err
  }

  const tryStream = async (candidateProvider, candidateType = type, opts = {}) => {
    // If the route already gave up, stop immediately — don't queue more
    // browser work behind the mutex or mark the provider as failed.
    if (signal?.aborted) return null
    const key = `${candidateProvider}:${candidateType}`
    if (tried.has(key)) return null
    tried.add(key)

    // Skip rate-limited providers — but only THIS provider, not all of them
    if (isProviderRateLimitedAny(candidateProvider)) {
      console.log(`[router] Skipping rate-limited provider: ${candidateProvider}`)
      return null
    }

    // Skip providers that recently failed (dead-provider skipping)
    if (isProviderInCooldown(candidateProvider)) {
      console.log(`[router] Skipping cooled-down provider: ${candidateProvider}`)
      return null
    }
    // Skip combos upstream already confirmed EMPTY for THIS title.
    // Without this, every re-visit re-raced the same dead combo for 20s.
    if (isTitleNoStream(anilistId, effectiveSlug, ep, candidateProvider, candidateType)) {
      console.log(`[router] Skipping no-stream (this title): ${candidateProvider}/${candidateType}`)
      return null
    }

    try {
      const data = await anidapProvider.getStream(effectiveSlug, ep, candidateProvider, candidateType, anilistId, { ...opts, titles: title, signal })
      if (!data) {
        // getStream swallows aborts internally and returns null — don't
        // punish a healthy provider because the route timed out.
        if (signal?.aborted) return null
        markTitleNoStream(anilistId, effectiveSlug, ep, candidateProvider, candidateType)
        markProviderCooldown(candidateProvider, 'empty stream')
        return null
      }
      clearProviderCooldown(candidateProvider)
      titleNoStreamCache.delete(`${effectiveSlug}:${ep}:${candidateProvider}:${candidateType}`)
      titleNoStreamCache.delete(`${anilistId}:${ep}:${candidateProvider}:${candidateType}`)
      return { ...data, source: 'anidap' }
    } catch (e) {
      // Aborts are the caller giving up, not a provider failure — never
      // cool down a provider because the route timed out.
      if (e?.name === 'AbortError' || e?.message?.includes('aborted')) return null
      const is429 = e?.upstream === 429 || e?.message?.includes('too_many_requests')
      if (is429) {
        const bareName = candidateProvider.replace(/^anidap-/, '')
        markProviderRateLimited(bareName, 15)
      } else if (e?.transient) {
        // Transient failure (DOM timeout, expired CDN token, challenge):
        // cool the provider briefly so the next request retries, but NEVER
        // record "no stream for this title" — a timeout or a dead CDN token
        // says nothing about upstream availability. Poisoning here locked
        // users out of working servers for the full 10-min TTL.
        markProviderCooldown(candidateProvider, e?.message || 'transient')
      } else {
        // Definitive 404 ("no stream available") = upstream CONFIRMED this
        // title+provider+type has nothing — cache per-title so later
        // requests fail fast instead of re-racing a known-dead combo.
        if (e?.upstream === 404) {
          markTitleNoStream(anilistId, effectiveSlug, ep, candidateProvider, candidateType)
        }
        markProviderCooldown(candidateProvider, e?.message || 'failed')
      }
      return null
    }
  }

  // ── Single racing pool (no sequential fast path) ──────────────────
  // A sequential "fast path" that tried the user's provider alone for 8s
  // wasted the whole route budget when the provider was slow-but-working
  // (~9-10s extractions), leaving the fallback pool zero time. Instead the
  // user's provider is queued FIRST in the pool below: a working provider
  // resolves in ~5-8s, dead providers fail fast and the next candidate runs.
  // The `tried` set prevents any candidate from being extracted twice.

  // Try gogoanime if the provider name starts with gogoanime-
  if (providerName && providerName.startsWith('gogoanime-')) {
    try {
      // Gogoanime pages are heavier (ads, iframes, Cloudflare) and must wait
      // for the same cf-harvester mutex that anidap uses. Give it enough
      // time to acquire the mutex and finish extraction.
      const gogoData = await Promise.race([
        gogoanimeProvider.getStream(effectiveSlug, ep, providerName, type, anilistId, { signal }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('gogoanime stream timeout')), 25_000),
        ),
      ])
      if (gogoData) return { ...gogoData, source: 'gogoanime' }
    } catch (e) {
      console.warn(`[router] gogoanime stream failed: ${e?.message || e}`)
    }
    console.log(`[router] gogoanime failed - falling through to anidap providers`)
  }

  // ── Parallel provider racing ──────────────────────────────────────
  // All candidates fire at once and race via Promise.race. The
  // cf-harvester mutex serialises actual browser operations, so the
  // fastest provider to complete its extraction wins regardless of
  // which one started first.
  //
  // CRITICAL: Rate-limited providers are FILTERED OUT of the race pool
  // instead of blocking the entire request. This means if yuki gets 429'd,
  // kami/koto/neko/vee/uwu all still race and one of them will win.
  try {
    const anidapResult = await Promise.race([
      (async () => {
        const providerList = await anidapProvider.getProviders(effectiveSlug, ep, anilistId, title)
        const sameTypeAll = (Array.isArray(providerList) ? providerList : [])
          .filter((p) => String(p.type) === String(type))
          .map((p) => normalizeProviderName(p.name))
          .filter((name) => name && name !== normalized)

        // While chad is bot-blocked, every candidate falls through to the
        // browser DOM path (mutex-serialised, ~10-20s each). Racing several
        // then just queues them behind the mutex and blows the route cap —
        // race ONLY the user's provider so one DOM extraction fits.
        let allCandidates
        if (isChadBlocked()) {
          allCandidates = [normalized]
        } else {
          // Build the racing pool: the user's provider + up to 2 fastest.
          // cf-harvester serialises browser work through a mutex (~5-6s per
          // provider), so a big pool just queues requests — 3 candidates max
          // keeps the whole race under the route cap.
          const fastFallbacks = sameTypeAll
            .filter((name) => FAST_PROVIDERS.includes(name))
            .slice(0, 2)
          const candidates = Array.from(new Set([normalized, ...fastFallbacks]))

          // Also include up to 1 extra non-fast provider in the race
          const extraProviders = sameTypeAll
            .filter((name) => !candidates.includes(name))
            .slice(0, 1)
          allCandidates = [...candidates, ...extraProviders]
        }

        // Per-provider timeout: 20 s. The browser-free chad fast path
        // resolves in ~1-3s once the slug is cached; the DOM fallback
        // (slug unknown, chad down) needs ~6s page load + ~5s extraction,
        // so 20s gives it room without letting a dead provider block the
        // mutex forever.
        const TRY_TIMEOUT_MS = 20_000
        const tryStreamWithTimeout = (candidate, candidateType = type) =>
          Promise.race([
            tryStream(candidate, candidateType, { maxDurationMs: TRY_TIMEOUT_MS - 1_000 }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('provider try timed out')), TRY_TIMEOUT_MS),
            ),
          ])

        // ── Filter out rate-limited/cooled providers from the race pool ──
        // Only the rate-limited/cooled provider is excluded; all others still race.
        allCandidates = allCandidates.filter((name) => !shouldSkipProvider(name))

        // ── ALWAYS keep the user's pick in the pool ──
        // The user's chosen server must never be silently dropped: after a
        // cooldown/429 mark it vanished from the pool and the route returned
        // 404 — the frontend then auto-fell through to ANOTHER server, so a
        // transient blip "permanently" switched the user's server. Being in
        // the pool costs nothing when it fails; being absent is wrong.
        if (!allCandidates.includes(normalized)) allCandidates.unshift(normalized)

        if (allCandidates.length === 0) {
          // All candidates are rate-limited — try cross-type
          console.warn(`[router] All ${type} providers rate-limited for #${anilistId}`)
          if (type === 'sub') {
            // Try dub as cross-type fallback
            const crossData = await tryStreamWithTimeout(normalized, 'dub')
            if (crossData) return crossData
          }
          throw new Error(`All providers rate-limited for ${type}`)
        }

        // Race all candidates in a loop: fire them all, then
        // repeatedly race the remaining pool, discarding each loser
        // until one succeeds or all are exhausted.
        // ROOT FIX — candidate concurrency cap: the harvester has a 3-page
        // extraction pool. Racing 6-7 candidates at once meant 3-4 waited
        // past every deadline and died as cooldowns even though the servers
        // work. Firing candidates through a 3-slot semaphore aligns demand
        // with capacity: everyone gets a full extraction budget in turn.
        // (Candidates that resolve without a page — cache hits, chad fast
        // path — release their slot immediately, so nothing is slowed.)
        const pending = allCandidates.map((candidate) => ({
          name: candidate,
          promise: candidateSlot(() => tryStreamWithTimeout(candidate, type))
            .then(
              (data) =>
                data
                  ? { ok: true, provider: candidate, data }
                  : { ok: false, provider: candidate },
            )
            .catch((err) => ({
              ok: false,
              provider: candidate,
              err: err?.message || String(err),
            })),
        }))

        // Cross-type fallback (sub -> dub) as last-resort
        const crossTypeEntry =
          type === 'sub'
            ? {
                name: `${normalized}(dub)`,
                promise: candidateSlot(() => tryStreamWithTimeout(normalized, 'dub'))
                  .then(
                    (data) =>
                      data
                        ? { ok: true, provider: `${normalized}(dub)`, data, crossType: true }
                        : { ok: false, provider: `${normalized}(dub)` },
                  )
                  .catch((err) => ({
                    ok: false,
                    provider: `${normalized}(dub)`,
                    err: err?.message || String(err),
                  })),
              }
            : null

        let remaining = [...pending]
        while (remaining.length > 0) {
          const tagged = remaining.map((p) =>
            p.promise.then((result) => ({ result, loser: p.name })),
          )
          const { result, loser } = await Promise.race(tagged)
          if (result.ok && result.data) {
            const tag = result.crossType ? ' (cross-type)' : ''
            console.log(
              `[router] Parallel race won by: ${result.provider}/${type}${tag}`,
            )
            return result.data
          }
          // Discard the loser and keep racing the survivors
          remaining = remaining.filter((p) => p.name !== loser)
        }

        // Same-type exhausted — try cross-type as last resort
        if (crossTypeEntry) {
          const result = await crossTypeEntry.promise
          if (result.ok && result.data) {
            console.log(
              `[router] Sub->dub fallback (last resort): ${normalized}`,
            )
            return result.data
          }
        }

        return null
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('anidap provider racing timeout')), 25_000),
      ),
    ])

    if (anidapResult) return anidapResult
  } catch (e) {
    // Per-provider rate-limit: don't trigger a global block
    if (e?.upstream === 429) {
      const bareName = normalized?.replace(/^anidap-/, '')
      markProviderRateLimited(bareName, 15)
      console.warn(`[router] Provider ${bareName} rate-limited (per-provider, 15s)`)
    }
    console.warn(`[router] anidap stream failed: ${e?.message || e}`)
  }

  // ── Fallback to gogoanime when anidap has no stream OR chad got
  // blocked mid-race. (Was gated on IS_ELECTRON — the Puppeteer/standalone
  // backend ships gogoanime too, and falling back keeps playback alive
  // when anidap confirms empty or is rate-limited.) ──
  if (!providerName?.startsWith('gogoanime-')) {
    try {
      console.log(`[router] anidap empty - trying gogoanime fallback for #${anilistId}`)
      const gogoInfo = await Promise.race([
        gogoanimeProvider.getInfoByAniListId(anilistId),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('gogoanime info timeout')), 15_000),
        ),
      ])
      if (gogoInfo?.slug) {
        const gogoProvider = type === 'dub' ? 'gogoanime-dub' : 'gogoanime-sub'
        const gogoData = await Promise.race([
          gogoanimeProvider.getStream(gogoInfo.slug, ep, gogoProvider, type, anilistId, { signal }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('gogoanime stream timeout')), 30_000),
          ),
        ])
        if (gogoData) {
          console.log(`[router] Gogoanime fallback succeeded for #${anilistId}`)
          return { ...gogoData, source: 'gogoanime' }
        }
      }
    } catch (e) {
      console.warn(`[router] gogoanime fallback failed: ${e?.message || e}`)
    }
  }

  // ── Both providers failed. If chad is site-wide blocked, surface the
  // real countdown so the client knows when to auto-retry. ──
  if (isChad429Blocked() && !providerName?.startsWith('gogoanime-')) {
    const remainingSec = getChad429Remaining()
    const err = new Error(`Anidap is temporarily rate-limited. Retry in ~${remainingSec}s.`)
    err.upstream = 429
    err.retryAfterSec = remainingSec
    throw err
  }

  const err = new Error(`No stream available for ${normalized || providerName}/${type}`)
  err.upstream = 404
  throw err
}
