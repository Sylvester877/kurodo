// Kitsu fallback feed — keeps the Home page alive when AniList's GraphQL
// API is down AND Jikan is unreachable (the dual-outage state that makes
// every primary catalog source 4xx/5xx at once).
//
// AniList's public API periodically enters its documented site-wide outage
// mode ("The AniList API has been temporarily disabled due to severe
// stability issues" — HTTP 403 for EVERY query, not an IP block), and
// Jikan 504s whenever MAL is unreachable. In that window the whole Home
// page (hero, Trending Now, Popular This Season, Most Favorite, Top 10,
// Seasonal) used to show error rows because every feed getter was
// AniList-GQL-only.
//
// Kitsu.app is a separate anime catalog that keeps serving during those
// outages. It exposes the same data family (titles, cover art, scores,
// status, season/year) AND a mappings table linking each title to its
// myanimelist id — which the rest of the app navigates by. This endpoint
// fetches a Kitsu list, resolves the MAL ids from the included mappings in
// the SAME response (one round trip), and returns the app's own FeedMedia
// shape so client fallbacks drop in with zero adapter changes.
//
//   GET /api/kitsu-feed?kind=trending|thisSeason|upcoming|top|season&perPage=18
//   GET /api/kitsu-feed?kind=season&season=WINTER&year=2026&perPage=30
//   → { ok:true, media: FeedMedia[], source:'kitsu' }   (MAL ids resolved)
//   → { ok:false }                                       (Kitsu itself down)
//
// The `season` kind powers the Seasonal Calendar page during outages
// (kind=season&season=WINTER&year=2026). Kitsu's filter[season]/seasonYear
// align with AniList's calendar (verified: Winter 2026 → Frieren S2,
// Jigokuraku S2 — all Jan starts).
//
// Only anime WITH a myanimelist mapping are returned — entries without one
// can't be navigated to in this app (everything keys off mal_id), so they
// would just silently disappear in feedToAnimeList anyway.
import axios from 'axios'

const KITSU = 'https://kitsu.app/api/edge'
const MAPPING_FIELDS = 'fields[mappings]=externalSite,externalId'
const TIMEOUT_MS = 12_000

// ── Cache ────────────────────────────────────────────────────────────
const mem = new Map() // key → { at, media }
const TTL = 30 * 60 * 1000 // 30 min — outage feeds don't need fresher
const FAIL_TTL = 2 * 60 * 1000 // short negative cache when Kitsu fails

function cacheGet(key) {
  const hit = mem.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return hit.media
  return undefined
}
function cacheSet(key, media, ttl) {
  mem.set(key, { at: Date.now(), media, ttl })
  if (mem.size > 120) {
    const n = Date.now()
    for (const [k, v] of mem) if (n - v.at > TTL) mem.delete(k)
  }
}

/** Kitsu `subtype` (TV/movie/OVA/ONA/special/music) → AniList `format`. */
function toFormat(subtype) {
  if (!subtype) return null
  const s = String(subtype).toLowerCase()
  if (s === 'tv') return 'TV'
  if (s === 'tv_short') return 'TV_SHORT'
  if (s === 'movie') return 'MOVIE'
  if (s === 'special') return 'SPECIAL'
  if (s === 'ova') return 'OVA'
  if (s === 'ona') return 'ONA'
  if (s === 'music') return 'MUSIC'
  return subtype.toUpperCase()
}

/** Kitsu `status` (current/finished/upcoming/…) → AniList status. */
function toStatus(status) {
  if (!status) return null
  const s = String(status).toLowerCase()
  if (s === 'current') return 'RELEASING'
  if (s === 'finished') return 'FINISHED'
  if (s === 'upcoming') return 'NOT_YET_RELEASED'
  if (s === 'cancelled') return 'CANCELLED'
  if (s === 'hiatus') return 'HIATUS'
  return s.toUpperCase()
}

/** startDate "2013-04-07" → { season, seasonYear } on AniList's calendar. */
function toSeason(startDate) {
  if (!startDate || typeof startDate !== 'string') return { season: null, seasonYear: null }
  const [, mon, yr] = /^(\d{4})-(\d{2})/.exec(startDate) || []
  const year = yr ? Number(yr) : null
  const m = mon ? Number(mon) : null
  if (!year || !m) return { season: null, seasonYear: null }
  const season = m <= 3 ? 'WINTER' : m <= 6 ? 'SPRING' : m <= 9 ? 'SUMMER' : 'FALL'
  return { season, seasonYear: year }
}

/**
 * Translate one Kitsu anime resource + the response's included mappings
 * into the app's FeedMedia shape. Returns null when the title has no
 * myanimelist mapping (unusable — the app navigates by mal_id).
 */
function kitsuToFeedMedia(anime, includedById) {
  const attrs = anime?.attributes || {}
  const relMappings = anime?.relationships?.mappings?.data || []
  let idMal = null
  for (const m of relMappings) {
    const inc = includedById.get(m.id)
    if (inc?.externalSite === 'myanimelist/anime' && inc?.externalId) {
      idMal = Number(inc.externalId)
      break
    }
  }
  if (!idMal || !Number.isFinite(idMal)) return null

  const poster = attrs.posterImage || {}
  const cover = attrs.coverImage || {}
  const extraLarge = poster.original || poster.large || poster.medium || ''
  const large = poster.large || poster.medium || poster.small || extraLarge
  const banner = cover.original || cover.large || cover.tiny || ''

  const { season, seasonYear } = toSeason(attrs.startDate)
  const synopsis = attrs.synopsis || attrs.description || null

  return {
    id: Number(anime.id),
    idMal,
    title: {
      romaji: attrs.titles?.en_jp || attrs.canonicalTitle || '',
      english: attrs.titles?.en || attrs.canonicalTitle || null,
      native: attrs.titles?.ja_jp || null,
    },
    coverImage: {
      extraLarge: extraLarge || null,
      large: large || null,
      color: null,
    },
    bannerImage: banner || null,
    episodes: attrs.episodeCount ?? null,
    duration: attrs.episodeLength ?? null,
    averageScore: attrs.averageRating != null ? Math.round(attrs.averageRating) : null,
    popularity: attrs.userCount ?? null,
    format: toFormat(attrs.subtype),
    status: toStatus(attrs.status),
    season,
    seasonYear,
    genres: [],
    studios: { nodes: [] },
    nextAiringEpisode: null,
    description: synopsis,
    trailer:
      attrs.youtubeVideoId
        ? { id: attrs.youtubeVideoId, site: 'youtube' }
        : null,
  }
}

/** Build the Kitsu list URL for a feed kind. */
function kitsuUrl(kind, perPage, season = null, year = null) {
  const limit = Math.min(Math.max(Number(perPage) || 18, 6), 50)
  // ⚠️ Do NOT sparsify fields[anime] here: Kitsu DROPS each anime's
  // relationships.mappings.data the moment a fields[anime] filter is
  // present, even when include=mappings is set — which would leave us
  // unable to attach MAL ids to titles (verified 2026-09-07). Sparse only
  // fields[mappings] so the included mapping objects stay small.
  const fields = `include=mappings&${MAPPING_FIELDS}`
  switch (kind) {
    case 'trending':
      // Kitsu has no TRENDING_DESC equivalent on the anime index; the
      // closest stable proxy is current airing ordered by user count
      // (the "what everyone is watching" signal).
      return `${KITSU}/anime?filter[status]=current&sort=-userCount&page[limit]=${limit}&${fields}`
    case 'thisSeason':
      return `${KITSU}/anime?filter[status]=current&sort=-userCount&page[limit]=${limit}&${fields}`
    case 'upcoming':
      return `${KITSU}/anime?filter[status]=upcoming&sort=-userCount&page[limit]=${limit}&${fields}`
    case 'season':
      return `${KITSU}/anime?filter[seasonYear]=${year}&filter[season]=${season.toLowerCase()}&sort=-userCount&page[limit]=${limit}&${fields}`
    case 'top':
      // All-time top rated (SCORE_DESC equivalent).
      return `${KITSU}/anime?sort=-averageRating&page[limit]=${limit}&${fields}`
    default:
      return null
  }
}

/**
 * Fetch a feed kind from Kitsu and translate to FeedMedia[].
 * Returns [] on any failure (never throws) so the client fallback can
 * simply fall through to its normal error state if even Kitsu is down.
 */
export async function getKitsuFeed(kind, perPage, season = null, year = null) {
  const key = `${kind}:${season ?? ''}:${year ?? ''}:${perPage}`
  const cached = cacheGet(key)
  if (cached !== undefined) return cached

  const url = kitsuUrl(kind, perPage, season, year)
  if (!url) {
    cacheSet(key, [], FAIL_TTL)
    return []
  }

  try {
    // Kitsu stalls (never responds) when the request has NO User-Agent —
    // every probe with a plain axios call timed out at 12s while the same
    // URL via fetch() (which sends a UA by default) returned in ~1s. Set an
    // identifying UA explicitly so the relay is treated as a real client.
    const { data } = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        Accept: 'application/vnd.api+json',
        'User-Agent': 'kurodo/0.3.37 (anime desktop app; fallback feed)',
      },
      validateStatus: (code) => code >= 200 && code < 300,
    })
    const includedById = new Map()
    for (const inc of data?.included || []) {
      // Kitsu's JSON:API type for these resources is 'mappings' (plural).
      if ((inc?.type === 'mappings' || inc?.type === 'mapping') && inc?.id != null) {
        includedById.set(String(inc.id), inc.attributes || {})
      }
    }
    const media = (data?.data || [])
      .map((a) => kitsuToFeedMedia(a, includedById))
      .filter(Boolean)
      .slice(0, perPage)
    cacheSet(key, media, TTL)
    return media
  } catch (e) {
    console.warn('[kitsu-feed] fetch failed:', kind, e?.message || e)
    cacheSet(key, [], FAIL_TTL)
    return []
  }
}

/** HTTP route registration — mounted by server/index.js. */
export function register(app) {
  app.get('/api/kitsu-feed', async (req, res) => {
    const kind = String(req.query.kind || '')
    const SEASON_KINDS = new Set(['trending', 'thisSeason', 'upcoming', 'top', 'season'])
    if (!SEASON_KINDS.has(kind)) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: `Unknown kind: ${kind}`, retryable: false } })
    }
    let season = null
    let year = null
    if (kind === 'season') {
      season = String(req.query.season || '').toUpperCase()
      year = Number(req.query.year)
      if (!['WINTER', 'SPRING', 'SUMMER', 'FALL'].includes(season) || !Number.isInteger(year) || year < 1980 || year > 2100) {
        return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'season requires valid season + year', retryable: false } })
      }
    }
    const perPage = Math.min(Math.max(Number(req.query.perPage) || 18, 1), 50)
    const media = await getKitsuFeed(kind, perPage, season, year)
    return res.json({ ok: true, media, source: 'kitsu' })
  })
}
