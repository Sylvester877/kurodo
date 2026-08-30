// filler-lib.js — pure filler-detection logic for the /api/filler route.
//
// Extracted from server/index.js so the route's decision logic and the two
// source parsers can be unit-tested WITHOUT booting the whole server
// (index.js starts an Express listener + cf-harvester on import). This
// module has NO side effects: it exports pure functions plus the
// `resolveFiller` orchestrator, which takes its fetchers as injected
// dependencies so tests can stub them with fakes.

export const FILLER_CACHE_TTL = 60 * 60 * 1000   // 1h success cache
export const FILLER_FAIL_TTL = 5 * 60 * 1000     // 5min negative cache

/**
 * Kebab-case a title for AnimeFillerList's /shows/{slug} URLs.
 * "Naruto Shippuden" → "naruto-shippuden". Empty/derivative-only titles
 * produce '' so callers can skip the AFL scrape entirely.
 */
export function aflSlugify(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Parse an AnimeFillerList.com show page into plain episode-number arrays.
 * The page renders condensed ranges like
 *   <div class="manga_canon"><span class="Label">Manga Canon Episodes:</span><span class="Episodes"><a onclick="jumpToNum(1);">1-7</a>, ...</span></div>
 * which we expand ("1-7" → [1..7]). Returns null when the page has no
 * episode data at all (wrong slug / non-show page).
 *
 * The returned object carries `source: 'afl'` so the /api/filler response
 * reports where the data came from, consistent with the Jikan fallback
 * (which reports `source: 'jikan'`).
 */
export function parseAFLPage(html) {
  const extract = (cls) => {
    // Match <div class="cls"><span class="Label">…</span><span class="Episodes">…anchors…</span></div>
    const m = html.match(new RegExp(`<div class="${cls}">\\s*<span class="Label">[^<]*</span>\\s*<span class="Episodes">([\\s\\S]*?)</span>`))
    if (!m) return []
    const nums = new Set()
    for (const am of m[1].matchAll(/jumpToNum\(\d+\);">([\d-]+)</g)) {
      const [a, b] = am[1].split('-').map(Number)
      for (let i = a; i <= (b || a); i++) nums.add(i)
    }
    return [...nums].sort((x, y) => x - y)
  }
  const canon = extract('manga_canon')
  const animeCanon = extract('anime_canon')
  const mixed = extract('mixed_canon\\/filler')
  const filler = extract('filler')
  const all = new Set([...canon, ...animeCanon, ...mixed, ...filler])
  if (all.size === 0) return null
  return {
    total_episodes: Math.max(...all),
    filler_episodes: filler,
    canon_episodes: canon,
    anime_canon_episodes: animeCanon,
    mixed_episodes: mixed,
    source: 'afl',
  }
}

/**
 * Build the standard filler response shape from Jikan's per-episode flags.
 * `flags` is a Map of episode number → { filler, recap } (built by the
 * paginated fetch in index.js). Returns null when nothing was collected.
 * Shape matches parseAFLPage so the client + cache treat both sources
 * identically — only `source` differs ('jikan' vs 'afl').
 */
export function buildJikanFiller(flags, total) {
  if (!flags || flags.size === 0) return null
  const filler = [...flags.entries()]
    .filter(([, f]) => f.filler)
    .map(([n]) => n)
    .sort((a, b) => a - b)
  const recap = [...flags.entries()]
    .filter(([, f]) => f.recap)
    .map(([n]) => n)
    .sort((a, b) => a - b)
  return {
    total_episodes: total,
    filler_episodes: filler,
    recap_episodes: recap,
    canon_episodes: [],
    anime_canon_episodes: [],
    mixed_episodes: [],
    source: 'jikan',
  }
}

/**
 * Pure route-decision logic for GET /api/filler/:malId.
 *
 * Fetchers are injected (defaults to no-op) so tests can stub them:
 *   fetchAFL(title)   → parseAFLPage-shaped object or null
 *   fetchJikan(malId) → buildJikanFiller-shaped object or null
 *   fetchLegacy(title, malId) → raw filler object or null
 *
 * Order: cache → negative cache → AFL → Jikan → legacy → 404.
 * The negative cache is ONLY written (and only honoured) for requests that
 * carried a usable ?title= — an empty-title miss can never match the AFL
 * matcher and must not block later titled requests (the original bug).
 *
 * Returns { status: 200, data, source?, hit? } or
 *         { status: 404, error, negativeHit? }.
 */
export async function resolveFiller({
  malId,
  title,
  cache,
  failCache,
  fetchAFL = null,
  fetchJikan = null,
  fetchLegacy = null,
}) {
  const cacheKey = `filler:${malId}`

  // Success cache
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < FILLER_CACHE_TTL) {
    return { status: 200, data: cached.data, hit: true }
  }

  // Negative cache — only honoured when the incoming title slug matches the
  // one that failed (a wrong-title 404 must not block a correct-title retry).
  const slug = aflSlugify(title)
  const failed = failCache.get(cacheKey)
  if (failed && failed.slug === slug && Date.now() - failed.at < FILLER_FAIL_TTL) {
    return { status: 404, error: 'No filler data found', negativeHit: true }
  }

  // ── Primary: AnimeFillerList scrape (richest data — canon/mixed/filler) ──
  if (slug && fetchAFL) {
    try {
      const afl = await fetchAFL(title)
      if (afl) {
        cache.set(cacheKey, { at: Date.now(), data: afl })
        return { status: 200, data: afl, source: afl.source }
      }
    } catch { /* fall through to Jikan */ }
  }

  // ── Jikan per-episode flags — catch-all for the whole MAL catalog ──
  if (fetchJikan) {
    try {
      const jikan = await fetchJikan(malId)
      if (jikan) {
        cache.set(cacheKey, { at: Date.now(), data: jikan })
        return { status: 200, data: jikan, source: jikan.source }
      }
    } catch { /* fall through to legacy */ }
  }

  // ── Legacy public APIs (dead as of 2026-08, kept in case they return) ──
  if (fetchLegacy) {
    try {
      const legacy = await fetchLegacy(title, malId)
      if (legacy) {
        cache.set(cacheKey, { at: Date.now(), data: legacy })
        return { status: 200, data: legacy, source: legacy.source }
      }
    } catch { /* give up */ }
  }

  // Cache the failure ONLY for titled requests — empty-title misses are not
  // evidence the show is missing, so they must not poison the key.
  if (slug) failCache.set(cacheKey, { at: Date.now(), slug })
  return { status: 404, error: 'No filler data found' }
}
