// TVDB v4 episode artwork resolver — REAL per-episode screenshots.
//
// This is the same source anikage.cc uses for its episode thumbnails:
//   https://artworks.thetvdb.com/banners/episodes/{seriesId}/{episodeId}.jpg
// and, for newer entries, v4 screencap paths like:
//   https://artworks.thetvdb.com/banners/v4/episode/{id}/screencap/{hash}.jpg
//
// Why this exists:
//   - AniZip only ships episode images for a handful of episodes of long
//     shows (Bleach: 21/366) and carries NO per-episode tvdb IDs.
//   - Jikan's episodes endpoint carries no images.
//   - TMDB has stills but they're often missing for older/longer shows and
//     the key is shared/rate-limited.
//   - TVDB v4's `/series/{id}/extended?meta=episodes` returns EVERY episode
//     with its `image` artwork path in ONE request. We turn that into a
//     full artworks.thetvdb.com URL (sends CORS *, loads direct in browser).
//
// Resolution chain: MAL id → AniZip (tvdbShowId) → TVDB v4 login → extended
// episodes → map by absolute episode number. Cached in-memory 24h.
import axios from 'axios'

const API_BASE = 'https://api4.thetvdb.com/v4'
const ARTWORKS_BASE = 'https://artworks.thetvdb.com'
// NOTE: read lazily at call time, NOT at import time. server/index.js loads
// dotenv AFTER its static imports are hoisted/evaluated, so a top-level
// const would capture an empty key in the live server (module sees '' but
// the .env.local value arrives moments later).
const getApiKey = () => (process.env.TVDB_API_KEY || '').trim()

// ── Token cache (login once, reuse until it expires) ──
let token = null
let tokenAt = 0
const TOKEN_TTL = 24 * 60 * 60 * 1000 // 24h

// ── Episode map cache: malId → { at, eps: Map<absNumber, { image, title, overview, airDate, runtime, seasonNumber }> } ──
const cache = new Map()
const TTL = 24 * 60 * 60 * 1000
const EMPTY_TTL = 6 * 60 * 60 * 1000

// ── TVDB series id cache: malId → { at, id } (from AniZip) ──
const seriesIdCache = new Map()
const SERIES_ID_TTL = 24 * 60 * 60 * 1000

async function getToken() {
  if (token && Date.now() - tokenAt < TOKEN_TTL) return token
  const TVDB_API_KEY = getApiKey()
  if (!TVDB_API_KEY) return null
  try {
    const { data } = await axios.post(
      `${API_BASE}/login`,
      { apikey: TVDB_API_KEY },
      { timeout: 15_000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36' } },
    )
    token = data?.data?.token || null
    tokenAt = Date.now()
    return token
  } catch (e) {
    console.warn('[tvdb] login failed:', e?.message || e)
    return null
  }
}

/** Resolve a MAL id → TVDB series id via AniZip's mapping endpoint. */
async function getSeriesIdFromMal(malId) {
  const hit = seriesIdCache.get(malId)
  if (hit && Date.now() - hit.at < SERIES_ID_TTL) return hit.id
  try {
    const { data } = await axios.get(
      `https://api.ani.zip/mappings?mal_id=${malId}`,
      { timeout: 10_000, headers: { 'User-Agent': 'Mozilla/5.0' } },
    )
    // AniZip returns tvdbShowId at top level (and thetvdb_id inside mappings)
    const id = data?.tvdbShowId || data?.mappings?.thetvdb_id || null
    if (id) seriesIdCache.set(malId, { at: Date.now(), id })
    return id
  } catch {
    // AniZip timed out / rate-limited — do NOT cache anything (the caller
    // will retry on the next request). Caching null here would lock the
    // anime out of TVDB artwork for the full cache TTL.
    return null
  }
}

/**
 * Fetch TVDB episode artwork using a pre-resolved TVDB series ID.
 * Callers that already have AniZip data (e.g. anikage-episodes) can call
 * this directly to avoid a second AniZip round-trip.
 */
export async function getTvdbEpisodesBySeriesId(seriesId) {
  if (!seriesId) return null

  // Check cache keyed by seriesId
  const hit = cache.get(`s:${seriesId}`)
  if (hit) {
    const ttl = hit.eps && hit.eps.size > 0 ? TTL : EMPTY_TTL
    if (Date.now() - hit.at < ttl) return hit.eps
  }

  const tok = await getToken()
  if (!tok) return null

  const eps = new Map()

  const fetchExtended = async (bearerToken) => {
    const { data } = await axios.get(
      `${API_BASE}/series/${seriesId}/extended?meta=episodes&short=false`,
      {
        headers: { Authorization: `Bearer ${bearerToken}`, 'User-Agent': 'Mozilla/5.0' },
        timeout: 20_000,
      },
    )
    const episodes = data?.data?.episodes || []
    for (const e of episodes) {
      const abs = Number(e.absoluteNumber ?? e.number)
      if (!abs || !Number.isFinite(abs) || abs < 1) continue
      if (!e.image) continue
      eps.set(abs, {
        image: e.image.startsWith('http')
          ? e.image
          : `${ARTWORKS_BASE}${e.image}`,
        title: e.name || null,
        overview: e.overview || null,
        airDate: e.aired || null,
        runtime: e.runtime ?? null,
        seasonNumber: e.seasonNumber ?? null,
      })
    }
  }

  try {
    await fetchExtended(tok)
  } catch (e) {
    if (e?.response?.status === 401) {
      token = null
      tokenAt = 0
      const tok2 = await getToken()
      if (tok2) {
        try { await fetchExtended(tok2) } catch (e2) {
          console.warn('[tvdb] retry after re-login also failed:', e2?.message || e2)
        }
      }
    } else {
      console.warn(`[tvdb] series ${seriesId} fetch failed:`, e?.message || e)
    }
  }

  cache.set(`s:${seriesId}`, { at: Date.now(), eps: eps.size > 0 ? eps : null })
  if (cache.size > 200) {
    const n = Date.now()
    for (const [k, v] of cache) if (n - v.at > TTL) cache.delete(k)
  }
  return eps.size > 0 ? eps : null
}

/**
 * Fetch TVDB episode artwork for an anime (all episodes in one request).
 * Returns a Map keyed by ABSOLUTE episode number:
 *   Map<number, { image, title, overview, airDate, runtime, seasonNumber }>
 * Returns null when the key is missing / login fails / no episodes.
 */
export async function getTvdbEpisodes(malId) {
  const hit = cache.get(malId)
  if (hit) {
    const ttl = hit.eps && hit.eps.size > 0 ? TTL : EMPTY_TTL
    if (Date.now() - hit.at < ttl) return hit.eps
  }

  const seriesId = await getSeriesIdFromMal(malId)
  if (!seriesId) {
    // No series id — either AniZip is down (transient, don't cache) or the
    // title genuinely has no TVDB entry (rare). Don't cache: an AniZip
    // hiccup shouldn't lock the anime out of TVDB artwork for hours.
    return null
  }

  const tok = await getToken()
  if (!tok) {
    // TVDB key missing/invalid — transient, don't poison the cache.
    return null
  }

  const eps = new Map()

  /** Fetch the extended episode list and fold its artwork into `eps`. */
  const fetchExtended = async (bearerToken) => {
    const { data } = await axios.get(
      `${API_BASE}/series/${seriesId}/extended?meta=episodes&short=false`,
      {
        headers: { Authorization: `Bearer ${bearerToken}`, 'User-Agent': 'Mozilla/5.0' },
        timeout: 20_000,
      },
    )
    const episodes = data?.data?.episodes || []
    for (const e of episodes) {
      // Prefer absolute episode number (global count across seasons, e.g.
      // Bleach 1-366). Fall back to season-local number for single-season
      // shows where absoluteNumber isn't populated.
      //
      // KNOWN LIMITATION: for multi-season shows where TVDB does NOT
      // populate absoluteNumber, `number` restarts per season so season-2
      // ep 1 and season-1 ep 1 collide in the Map (one wins). Those shows
      // simply get no TVDB images for the shadowed episodes and fall back
      // to TMDB/AniZip — never a crash, just a coverage gap.
      const abs = Number(e.absoluteNumber ?? e.number)
      if (!abs || !Number.isFinite(abs) || abs < 1) continue
      if (!e.image) continue
      eps.set(abs, {
        image: e.image.startsWith('http')
          ? e.image
          : `${ARTWORKS_BASE}${e.image}`,
        title: e.name || null,
        overview: e.overview || null,
        airDate: e.aired || null,
        runtime: e.runtime ?? null,
        seasonNumber: e.seasonNumber ?? null,
      })
    }
  }

  try {
    await fetchExtended(tok)
  } catch (e) {
    // Token may have been invalidated server-side — clear it and retry
    // once with a fresh login before giving up.
    if (e?.response?.status === 401) {
      token = null
      tokenAt = 0
      console.warn('[tvdb] 401 on series fetch — re-login and retry once')
      const tok2 = await getToken()
      if (tok2) {
        try {
          await fetchExtended(tok2)
        } catch (e2) {
          console.warn('[tvdb] retry after re-login also failed:', e2?.message || e2)
        }
      }
    } else {
      console.warn(`[tvdb] series ${seriesId} fetch failed:`, e?.message || e)
    }
  }

  cache.set(malId, { at: Date.now(), eps: eps.size > 0 ? eps : null })
  if (cache.size > 200) {
    const n = Date.now()
    for (const [k, v] of cache) if (n - v.at > TTL) cache.delete(k)
  }
  return eps.size > 0 ? eps : null
}

/** Exposed for the health endpoint / diagnostics. */
export function getTvdbStatus() {
  return { configured: !!getApiKey(), tokenCached: !!token, seriesCached: seriesIdCache.size }
}
