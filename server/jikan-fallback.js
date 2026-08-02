// AniList fallback for the Jikan proxy.
// Jikan (api.jikan.moe) frequently 504s when MyAnimeList is unreachable.
// These helpers query AniList and return data in a Jikan-compatible shape
// so the existing frontend components continue to work without changes.

import axios from 'axios'

const ANILIST_GQL = 'https://graphql.anilist.co'

// ── Global AniList throttle + 429 circuit breaker ────────────────────
// AniList enforces ~90 req/min per IP. When Jikan is down (504), EVERY
// /api/jikan/* request converts into an AniList fallback call — without a
// shared pace the app blows past the limit in seconds, then the 429s
// themselves get retried 3× more (retry storm) and the fallback dies too.
//
//   • MIN_INTERVAL paces calls so bursts stay under AniList's budget.
//   • The 429 breaker pauses ALL fallback calls for 15s after a 429 so
//     AniList can recover instead of being hammered while throttled.
const MIN_ANILIST_INTERVAL_MS = 700   // ≈ ≤85 req/min — headroom under 90
const ANILIST_BREAKER_MS = 15_000     // pause after a 429
let lastAnilistCallAt = 0
let anilistBreakerUntil = 0

async function paceAniList() {
  // Circuit breaker: if AniList just 429'd us, don't pile on — fail fast.
  if (Date.now() < anilistBreakerUntil) {
    const err = new Error('AniList rate-limited (breaker active)')
    err.status = 429
    throw err
  }
  const wait = lastAnilistCallAt + MIN_ANILIST_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAnilistCallAt = Date.now()
}

async function anilistRequest(query, variables = {}, { maxRetries = 3 } = {}) {
  await paceAniList()
  let lastError = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await axios.post(
        ANILIST_GQL,
        { query, variables },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          timeout: 10_000,
          validateStatus: () => true,
        },
      )

      // AniList returns 200 with errors array for GraphQL errors, but it can
      // also 429 or 5xx when overloaded.  Retry transient failures.
      if (data?.errors && !data?.data) {
        // 429 error bodies come through the errors array — open the breaker.
        if (data.errors.some((er) => er.status === 429)) {
          anilistBreakerUntil = Date.now() + ANILIST_BREAKER_MS
          const err = new Error(data.errors[0]?.message || 'AniList rate-limited')
          err.status = 429
          throw err
        }
        return data
      }
      return data
    } catch (e) {
      const status = e?.status || e?.response?.status
      // 429 — never retry from the fallback: opening the breaker is enough,
      // and retrying only deepens the storm.
      if (status === 429) {
        anilistBreakerUntil = Date.now() + ANILIST_BREAKER_MS
        throw e
      }
      lastError = e
      // Retry on network/timeout errors or server errors.
      if (attempt < maxRetries && (status >= 500 || e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT')) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 8000)
        console.warn(`[jikan-fallback] AniList request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${status || e.code}, retrying in ${waitMs}ms`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      break
    }
  }
  throw lastError || new Error('AniList fallback request failed')
}

function statusToJikan(status) {
  const map = {
    RELEASING: 'Currently Airing',
    FINISHED: 'Finished Airing',
    NOT_YET_RELEASED: 'Not yet aired',
    CANCELLED: 'Cancelled',
  }
  return map[status] || status
}

function mapMedia(media) {
  const cover =
    media.coverImage?.extraLarge || media.coverImage?.large || media.bannerImage || ''
  const title = media.title?.english || media.title?.romaji || ''

  let trailer = null
  if (media.trailer?.id && media.trailer?.site === 'youtube') {
    const id = media.trailer.id
    trailer = {
      youtube_id: id,
      url: `https://www.youtube.com/watch?v=${id}`,
      embed_url: `https://www.youtube.com/embed/${id}`,
    }
  }

  const genres = (media.genres || []).map((g) => ({
    mal_id: null,
    type: 'anime',
    name: g,
    url: '',
  }))

  return {
    mal_id: media.idMal ?? media.id,
    url: `https://myanimelist.net/anime/${media.idMal ?? media.id}`,
    images: {
      jpg: { image_url: cover, large_image_url: cover, small_image_url: cover },
      webp: { image_url: cover, large_image_url: cover, small_image_url: cover },
    },
    trailer,
    approved: true,
    titles: [
      { type: 'Default', title: media.title?.english || media.title?.romaji || '' },
      { type: 'English', title: media.title?.english || '' },
      { type: 'Japanese', title: media.title?.native || '' },
    ],
    title: media.title?.english || media.title?.romaji || '',
    title_english: media.title?.english || null,
    title_japanese: media.title?.native || null,
    title_synonyms: [],
    type: media.format,
    source: null,
    episodes: media.episodes ?? null,
    status: statusToJikan(media.status),
    airing: media.status === 'RELEASING',
    aired: {
      from: null,
      to: null,
      string: null,
    },
    duration: media.duration ? `${media.duration} min` : null,
    rating: null,
    score: media.averageScore ? media.averageScore / 10 : null,
    scored_by: null,
    rank: null,
    popularity: media.popularity ?? null,
    members: null,
    favorites: null,
    synopsis: media.description ? media.description.replace(/<[^>]+>/g, '') : null,
    background: null,
    season: media.season?.toLowerCase() || null,
    year: media.seasonYear ?? null,
    broadcast: null,
    producers: [],
    licensors: [],
    studios:
      media.studios?.nodes?.map((s) => ({ mal_id: null, type: '', name: s.name, url: '' })) || [],
    genres,
    explicit_genres: [],
    themes: [],
    demographics: [],
    relations: [],
    external: [],
    streaming: [],
  }
}

export async function searchAniListAsJikan(q, page = 1, limit = 24) {
  // AniList errors on an empty/null search argument. If no query is supplied,
  // fall back to a "top/popular" query by omitting the `search` argument and
  // sorting by popularity instead of search-match relevance.
  const hasQuery = q && q.trim()
  const safeQ = hasQuery ? q.trim() : null

  // Clamp values to sensible ranges before touching AniList.
  const safePage = Math.max(1, Number.isFinite(page) ? page : 1)
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? limit : 24))

  // Build the GraphQL so the $q variable is only declared when it is used.
  const qVar = hasQuery ? '$q: String, ' : ''
  const mediaArgs = hasQuery
    ? 'search: $q, type: ANIME, sort: SEARCH_MATCH'
    : 'type: ANIME, sort: POPULARITY_DESC'

  const query = `query (${qVar}$page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage currentPage lastPage total }
      media(${mediaArgs}) {
        id idMal
        title { romaji english native }
        description(asHtml: false)
        bannerImage
        coverImage { extraLarge large }
        episodes duration averageScore popularity format status season seasonYear genres
        studios(isMain: true) { nodes { name } }
        trailer { id site }
      }
    }
  }`

  const variables = { page: safePage, perPage: safeLimit }
  if (hasQuery) variables.q = safeQ
  const data = await anilistRequest(query, variables)
  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message || 'AniList GraphQL error')
  }
  const pageInfo = data?.data?.Page?.pageInfo || { hasNextPage: false, currentPage: 1, lastPage: 1 }
  const media = data?.data?.Page?.media || []

  return {
    data: media.map(mapMedia),
    pagination: {
      has_next_page: pageInfo.hasNextPage,
      current_page: pageInfo.currentPage,
      last_visible_page: pageInfo.lastPage,
      items: {
        count: media.length,
        total: pageInfo.total ?? media.length,
        per_page: safeLimit,
      },
    },
  }
}

export async function getAniListAnimeByMalAsJikan(malId) {
  const query = `query ($malId: Int) {
    Media(idMal: $malId, type: ANIME) {
      id idMal
      title { romaji english native }
      description(asHtml: false)
      bannerImage
      coverImage { extraLarge large }
      episodes duration averageScore popularity format status season seasonYear genres
      studios(isMain: true) { nodes { name } }
      trailer { id site }
    }
  }`
  const data = await anilistRequest(query, { malId })
  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message || 'AniList GraphQL error')
  }
  const media = data?.data?.Media
  if (!media) {
    const err = new Error('Anime not found on AniList')
    err.status = 404
    throw err
  }
  return { data: mapMedia(media) }
}

/**
 * Route-level dispatcher: try to satisfy a Jikan-style request from AniList
 * when Jikan itself is down or returns a 504. Returns Jikan-shaped data for
 * /anime search and /anime/:id endpoints, or null for unsupported paths.
 */
export async function tryAniListFallback(targetPath, query) {
  const page = Math.max(1, Number.isFinite(Number(query.page)) ? Number(query.page) : 1)
  const limit = Math.max(1, Number.isFinite(Number(query.limit)) ? Number(query.limit) : 24)

  // Express can turn repeated query params into arrays; only use the first value.
  const rawQ = Array.isArray(query.q) ? query.q[0] : query.q

  if (targetPath === '/anime') {
    return await searchAniListAsJikan(rawQ ? String(rawQ) : undefined, page, limit)
  }

  const animeIdMatch = targetPath.match(/^\/anime\/(\d+)(?:\/full)?$/)
  if (animeIdMatch) {
    return await getAniListAnimeByMalAsJikan(Number(animeIdMatch[1]))
  }

  return null
}
