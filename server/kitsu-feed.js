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
  // Kitsu hard-caps page[limit] at 20 (verified 2026-09-07: limit=24 →
  // HTTP 400 "Limit exceeds maximum page size of 20"). Clamp so Browse's
  // 24/page and Seasonal's 30/page requests degrade to a full 20-item page
  // instead of failing the whole fallback.
  const limit = Math.min(Math.max(Number(perPage) || 18, 6), 20)
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
    case 'popular':
      // All-time most-followed (POPULARITY_DESC equivalent).
      return `${KITSU}/anime?sort=-userCount&page[limit]=${limit}&${fields}`
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
    const SEASON_KINDS = new Set(['trending', 'thisSeason', 'upcoming', 'top', 'popular', 'season'])
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

// ── Jikan-shape bridge (final stage of the /api/jikan/* fallback chain) ──
// When BOTH Jikan (504) and AniList (403 site-wide disable) are down, the
// Browse catalog still needs to paint. Kitsu stays up, so we translate its
// FeedMedia list into Jikan's v4 list-item shape — the exact contract the
// existing /api/jikan/* consumers (Browse grid cards) already understand.
const JIKAN_STATUS = {
  RELEASING: 'Currently Airing',
  FINISHED: 'Finished Airing',
  NOT_YET_RELEASED: 'Not yet aired',
  CANCELLED: 'Cancelled',
  HIATUS: 'On Hiatus',
}

function feedToJikanList(m) {
  if (!m || !m.idMal) return null
  const img = m.coverImage?.extraLarge || m.coverImage?.large || ''
  const thumb = m.coverImage?.large || m.coverImage?.extraLarge || ''
  return {
    mal_id: m.idMal,
    url: `https://myanimelist.net/anime/${m.idMal}`,
    images: {
      jpg: { image_url: img, large_image_url: img, small_image_url: thumb },
      webp: { image_url: img, large_image_url: img, small_image_url: thumb },
    },
    trailer: m.trailer?.id && m.trailer?.site === 'youtube'
      ? { youtube_id: m.trailer.id, url: `https://www.youtube.com/watch?v=${m.trailer.id}`, embed_url: `https://www.youtube.com/embed/${m.trailer.id}` }
      : null,
    title: m.title?.romaji || '',
    title_english: m.title?.english || null,
    title_japanese: m.title?.native || null,
    type: m.format === 'TV' ? 'TV' : m.format === 'MOVIE' ? 'Movie' : m.format || null,
    source: null,
    episodes: m.episodes,
    status: JIKAN_STATUS[m.status] || m.status || null,
    airing: m.status === 'RELEASING',
    aired: { from: null, to: null, string: m.seasonYear ? `${m.season} ${m.seasonYear}` : null },
    duration: m.duration ? `${m.duration} min per ep` : null,
    rating: null,
    score: m.averageScore ?? null,
    scored_by: null,
    rank: null,
    popularity: m.popularity ?? null,
    members: null,
    favorites: null,
    synopsis: m.description || null,
    background: null,
    season: m.season || null,
    year: m.seasonYear ?? null,
    genres: (m.genres || []).map((g) => ({ mal_id: 0, type: 'genre', name: g })),
  }
}

/**
 * Final-stage fallback for /api/jikan/* when Jikan AND AniList both fail:
 * serve list endpoints (top / popular / upcoming / this-season / explicit
 * season) from Kitsu in Jikan's v4 shape so Browse keeps painting cards.
 * Page 1 only (no offset paging here); A–Z letters, genres and details
 * return null → those keep their normal 502 (they have honest error UIs).
 */
/** Kitsu anime resource → Jikan v4 detail-shape Anime (single-title). */
function kitsuToJikanDetail(malId, anime) {
  const attrs = anime?.attributes || {}
  const poster = attrs.posterImage || {}
  const extraLarge = poster.original || poster.large || poster.medium || ''
  const large = poster.large || poster.medium || poster.small || extraLarge
  const img = extraLarge
  const thumb = large
  const { season, seasonYear } = toSeason(attrs.startDate)
  const typeRaw = toFormat(attrs.subtype)
  const type = typeRaw === 'TV_SHORT' ? 'TV' : typeRaw || null
  const trailers = attrs.youtubeVideoId
    ? {
        youtube_id: attrs.youtubeVideoId,
        url: `https://www.youtube.com/watch?v=${attrs.youtubeVideoId}`,
        embed_url: `https://www.youtube.com/embed/${attrs.youtubeVideoId}`,
        images: {
          image_url: null, small_image_url: null, medium_image_url: null,
          large_image_url: null, maximum_image_url: null,
        },
      }
    : {
        youtube_id: null, url: null, embed_url: null,
        images: {
          image_url: null, small_image_url: null, medium_image_url: null,
          large_image_url: null, maximum_image_url: null,
        },
      }
  return {
    mal_id: malId,
    url: `https://myanimelist.net/anime/${malId}`,
    images: {
      jpg: { image_url: img, large_image_url: img, small_image_url: thumb },
      webp: { image_url: img, large_image_url: img, small_image_url: thumb },
    },
    trailer: trailers,
    title: attrs.titles?.en_jp || attrs.canonicalTitle || '',
    title_english: attrs.titles?.en || attrs.canonicalTitle || null,
    title_japanese: attrs.titles?.ja_jp || null,
    type: type || '',
    source: null,
    episodes: attrs.episodeCount ?? null,
    status: JIKAN_STATUS[toStatus(attrs.status)] || toStatus(attrs.status) || 'Unknown',
    airing: attrs.status === 'current',
    aired: {
      from: attrs.startDate || null,
      to: attrs.endDate || null,
      string: seasonYear ? `${season} ${seasonYear}` : attrs.startDate || null,
    },
    duration: attrs.episodeLength ? `${attrs.episodeLength} min per ep` : null,
    rating: attrs.ageRating ? String(attrs.ageRating).replace(/_/g, ' ') : null,
    score: attrs.averageRating != null ? Math.round(attrs.averageRating * 10) / 10 : null,
    scored_by: attrs.ratingRank ? attrs.userCount : null,
    rank: attrs.ratingRank ?? null,
    popularity: attrs.userCount ?? null,
    members: attrs.userCount ?? null,
    favorites: attrs.favoritesCount ?? null,
    synopsis: attrs.synopsis || attrs.description || null,
    background: null,
    season: season || null,
    year: seasonYear ?? null,
    genres: [],
    studios: [],
    themes: [],
    demographics: [],
  }
}

/**
 * Kitsu single-title detail in Jikan v4 shape, looked up by MAL id via
 * Kitsu's mappings table (one round trip: mapping → included subject).
 * Returns null when Kitsu is down or the MAL id has no Kitsu entry.
 */
async function getKitsuAnimeDetailByMal(malId) {
  const key = `detail:${malId}`
  const cached = cacheGet(key)
  if (cached !== undefined) return cached
  try {
    // `include=item` — Kitsu's mappings resource names its polymorphic
    // relationship `item` (verified 2026-09-07; `subject`/`mappingItem` are
    // both rejected with 400 "not a valid relationship"). The included
    // resource carries the anime attributes we translate below.
    const url = `${KITSU}/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${malId}&include=item`
    const { data } = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        Accept: 'application/vnd.api+json',
        'User-Agent': 'kurodo/0.3.38 (anime desktop app; fallback feed)',
      },
      validateStatus: (code) => code >= 200 && code < 300,
    })
    const mapping = data?.data?.[0]
    if (!mapping) {
      cacheSet(key, null, FAIL_TTL)
      return null
    }
    const subjectId = mapping?.relationships?.item?.data?.id
    const subject = (data?.included || []).find(
      (inc) => (inc?.type === 'anime' || inc?.type === 'media') && subjectId != null && String(inc.id) === String(subjectId),
    )
    if (!subject) {
      cacheSet(key, null, FAIL_TTL)
      return null
    }
    const anime = kitsuToJikanDetail(malId, subject)
    cacheSet(key, anime, TTL)
    return anime
  } catch (e) {
    console.warn('[kitsu-feed] detail lookup failed:', malId, e?.message || e)
    cacheSet(key, null, FAIL_TTL)
    return null
  }
}

/**
 * Kitsu title search in Jikan v4 list shape (MAL ids resolved via the same
 * mappings include). Powers the search page + quick search during outages.
 */
async function getKitsuSearchAsJikan(q, page, limit) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 20)
  const offset = (Math.max(1, page) - 1) * lim
  const key = `search:${q}:${lim}:${offset}`
  const cached = cacheGet(key)
  if (cached !== undefined) return cached
  try {
    const url = `${KITSU}/anime?filter[text]=${encodeURIComponent(String(q))}&include=mappings&${MAPPING_FIELDS}&page[limit]=${lim}&page[offset]=${offset}`
    const { data } = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        Accept: 'application/vnd.api+json',
        'User-Agent': 'kurodo/0.3.38 (anime desktop app; fallback feed)',
      },
      validateStatus: (code) => code >= 200 && code < 300,
    })
    const includedById = new Map()
    for (const inc of data?.included || []) {
      if ((inc?.type === 'mappings' || inc?.type === 'mapping') && inc?.id != null) {
        includedById.set(String(inc.id), inc.attributes || {})
      }
    }
    const total = Number(data?.meta?.count) || 0
    const rows = (data?.data || [])
      .map((a) => kitsuToFeedMedia(a, includedById))
      .filter(Boolean)
      .map(feedToJikanList)
      .filter(Boolean)
    if (rows.length === 0) {
      cacheSet(key, null, FAIL_TTL)
      return null
    }
    const out = {
      data: rows,
      pagination: {
        last_visible_page: Math.max(1, Math.ceil(total / lim)),
        has_next_page: offset + rows.length < total,
        current_page: page,
        items: { count: total, total, per_page: lim, pages: Math.max(1, Math.ceil(total / lim)) },
      },
    }
    cacheSet(key, out, TTL)
    return out
  } catch (e) {
    console.warn('[kitsu-feed] search fallback failed:', q, e?.message || e)
    cacheSet(key, null, FAIL_TTL)
    return null
  }
}

/**
 * Genre browse fallback (/anime?genres=:id&order_by=score&sort=desc).
 *
 * Kitsu has no MAL genre ids, but its category titles align with MAL's
 * anime genre names — so map MAL genre id → Kitsu category slug and serve
 * the top-userCount titles of that category. Slugs verified live
 * (2026-09-09: action → 6366 titles, mappings intact); a slug that Kitsu
 * doesn't recognize simply returns 0 rows → null → the honest 502 UI.
 */
const MAL_GENRE_TO_KITSU_CATEGORY = {
  1: 'action',
  2: 'adventure',
  4: 'comedy',
  5: 'avant-garde',
  7: 'mystery',
  8: 'drama',
  10: 'fantasy',
  14: 'horror',
  22: 'romance',
  24: 'sci-fi',
  26: 'girls-love',
  28: 'boys-love',
  30: 'sports',
  36: 'slice-of-life',
  37: 'supernatural',
  41: 'suspense',
  46: 'award-winning',
  47: 'gourmet',
}

async function getKitsuGenreAsJikan(genreId, limit) {
  const slug = MAL_GENRE_TO_KITSU_CATEGORY[genreId]
  if (!slug) return null
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 20)
  const key = `genre:${genreId}:${lim}`
  const cached = cacheGet(key)
  if (cached !== undefined) return cached
  try {
    const url = `${KITSU}/anime?filter[categories]=${encodeURIComponent(slug)}&sort=-userCount&include=mappings&${MAPPING_FIELDS}&page[limit]=${lim}`
    const { data } = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        Accept: 'application/vnd.api+json',
        'User-Agent': 'kurodo/0.3.38 (anime desktop app; fallback feed)',
      },
      validateStatus: (code) => code >= 200 && code < 300,
    })
    const includedById = new Map()
    for (const inc of data?.included || []) {
      if ((inc?.type === 'mappings' || inc?.type === 'mapping') && inc?.id != null) {
        includedById.set(String(inc.id), inc.attributes || {})
      }
    }
    const rows = (data?.data || [])
      .map((a) => kitsuToFeedMedia(a, includedById))
      .filter(Boolean)
      .map(feedToJikanList)
      .filter(Boolean)
    if (rows.length === 0) {
      cacheSet(key, null, FAIL_TTL)
      return null
    }
    const total = Number(data?.meta?.count) || rows.length
    const out = {
      data: rows,
      pagination: {
        last_visible_page: 1,
        has_next_page: false,
        current_page: 1,
        items: { count: rows.length, total, per_page: lim, pages: 1 },
      },
    }
    cacheSet(key, out, TTL)
    return out
  } catch (e) {
    console.warn('[kitsu-feed] genre fallback failed:', genreId, e?.message || e)
    cacheSet(key, null, FAIL_TTL)
    return null
  }
}

/**
 * A–Z letter fallback (/anime?letter=X&order_by=title&sort=asc).
 *
 * Kitsu has no starts-with filter, so approximate it: pull a pool of
 * highest-userCount titles whose text-search matches the letter, then
 * prefix-filter by canonical/en title client-side. Coverage is partial
 * (a pool of 100 can't hold every title starting with a common letter) —
 * but it keeps the grid painting real titles during a dual outage instead
 * of a dead end. AniList sorting (its prefix search) stays the primary
 * quality path; this stage is the outage net.
 */
async function getKitsuLetterAsJikan(letter, limit) {
  const L = String(letter || '').trim().charAt(0).toUpperCase()
  if (!/^[A-Z]$/.test(L)) return null
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 20)
  const key = `letter:${L}:${lim}`
  const cached = cacheGet(key)
  if (cached !== undefined) return cached
  try {
    // Pool of 100 (5 × 20-capped pages in parallel) then prefix-filter.
    const poolUrls = [0, 20, 40, 60, 80].map(
      (offset) =>
        `${KITSU}/anime?filter[text]=${encodeURIComponent(L)}&sort=-userCount&include=mappings&${MAPPING_FIELDS}&page[limit]=20&page[offset]=${offset}`,
    )
    const responses = await Promise.all(
      poolUrls.map((url) =>
        axios.get(url, {
          timeout: TIMEOUT_MS,
          headers: {
            Accept: 'application/vnd.api+json',
            'User-Agent': 'kurodo/0.3.38 (anime desktop app; fallback feed)',
          },
          validateStatus: (code) => code >= 200 && code < 300,
        }).catch(() => null),
      ),
    )
    const rows = []
    const seen = new Set()
    for (const res of responses) {
      if (!res) continue
      const includedById = new Map()
      for (const inc of res.data?.included || []) {
        if ((inc?.type === 'mappings' || inc?.type === 'mapping') && inc?.id != null) {
          includedById.set(String(inc.id), inc.attributes || {})
        }
      }
      for (const a of res.data?.data || []) {
        const attrs = a?.attributes || {}
        const title = attrs.titles?.en_jp || attrs.canonicalTitle || ''
        if (!title.toUpperCase().startsWith(L)) continue
        const m = kitsuToFeedMedia(a, includedById)
        if (!m || seen.has(m.idMal)) continue
        seen.add(m.idMal)
        rows.push(feedToJikanList(m))
        if (rows.length >= lim) break
      }
      if (rows.length >= lim) break
    }
    if (rows.length === 0) {
      cacheSet(key, null, FAIL_TTL)
      return null
    }
    // Jikan's letter query is always alphabetical — keep that contract.
    rows.sort((x, y) => (x.title || '').localeCompare(y.title || ''))
    const out = {
      data: rows,
      pagination: {
        last_visible_page: 1,
        has_next_page: false,
        current_page: 1,
        items: { count: rows.length, total: rows.length, per_page: lim, pages: 1 },
      },
    }
    cacheSet(key, out, TTL)
    return out
  } catch (e) {
    console.warn('[kitsu-feed] letter fallback failed:', L, e?.message || e)
    cacheSet(key, null, FAIL_TTL)
    return null
  }
}

/**
 * Final-stage fallback for /api/jikan/* when Jikan AND AniList both fail:
 * serve list endpoints (top / popular / upcoming / this-season / explicit
 * season), title search (/anime?q=…), single-title details
 * (/anime/:id[/full]), genre browse (/anime?genres=:id) and A–Z letters
 * (/anime?letter=X) from Kitsu in Jikan's v4 shape so Browse, Search and
 * the Anime details page keep working. Genre/letter coverage is partial
 * (see each stage's doc) but always real titles with real MAL ids.
 */
export async function getKitsuFeedAsJikan(targetPath, query) {
  const page = Math.max(1, Number.isFinite(Number(query?.page)) ? Number(query.page) : 1)

  // Single-title detail by MAL id (both /anime/:id and /anime/:id/full).
  const detailMatch = targetPath.match(/^\/anime\/(\d+)(?:\/full)?$/)
  if (detailMatch) {
    const anime = await getKitsuAnimeDetailByMal(Number(detailMatch[1]))
    return anime ? { data: anime } : null
  }

  // Title search list (/anime?q=…).
  if (targetPath === '/anime' && query?.q) {
    const q = Array.isArray(query.q) ? query.q[0] : query.q
    if (q && String(q).trim()) {
      const out = await getKitsuSearchAsJikan(String(q).trim(), page, query.limit)
      return out
    }
  }

  // Genre browse (/anime?genres=:id) — must precede generic /anime matching.
  if (targetPath === '/anime' && query?.genres != null) {
    const gid = Number(Array.isArray(query.genres) ? query.genres[0] : query.genres)
    if (Number.isInteger(gid) && gid > 0 && page === 1) {
      return await getKitsuGenreAsJikan(gid, query.limit)
    }
    return null
  }

  // A–Z letter browse (/anime?letter=X) — must precede generic /anime matching.
  if (targetPath === '/anime' && query?.letter != null) {
    const letter = Array.isArray(query.letter) ? query.letter[0] : query.letter
    if (page === 1) {
      return await getKitsuLetterAsJikan(String(letter || ''), query.limit)
    }
    return null
  }

  if (page > 1) return null
  const limit = Math.min(Math.max(Number(query?.limit) || 24, 1), 50)

  let kind = null
  let season = null
  let year = null
  if (targetPath === '/top/anime') {
    const rawFilter = Array.isArray(query?.filter) ? query.filter[0] : query?.filter
    kind = rawFilter === 'bypopularity' ? 'popular' : 'top'
  } else if (targetPath === '/seasons/upcoming') {
    kind = 'upcoming'
  } else if (targetPath === '/seasons/now') {
    kind = 'thisSeason'
  } else {
    const seasonMatch = targetPath.match(/^\/seasons\/(\d{4})\/(winter|spring|summer|fall)$/i)
    if (seasonMatch) {
      kind = 'season'
      year = Number(seasonMatch[1])
      season = String(seasonMatch[2]).toUpperCase()
    }
  }
  if (!kind) return null

  try {
    const media = await getKitsuFeed(kind, limit, season, year)
    if (!media || media.length === 0) return null
    const data = media.map(feedToJikanList).filter(Boolean)
    if (data.length === 0) return null
    return {
      data,
      pagination: {
        last_visible_page: 1,
        has_next_page: false,
        current_page: 1,
        items: { count: data.length, total: data.length, per_page: limit, pages: 1 },
      },
    }
  } catch (e) {
    console.warn('[kitsu-feed] jikan-shape fallback failed:', targetPath, e?.message || e)
    return null
  }
}
