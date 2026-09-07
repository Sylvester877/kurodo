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

/** Jikan-shaped /top/anime list from AniList (Jikan is often down).
 *  Jikan's filters: (default) score, bypopularity, airing, upcoming, and
 *  format filters (tv/movie/ova/special). AniList sorts cover the main
 *  ones; format filters map to AniList's format enum. */
export async function getTopAnimeFromAniList(page = 1, limit = 24, filter = '') {
  const safePage = Math.max(1, Number.isFinite(page) ? page : 1)
  const safeLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? limit : 24))
  const f = String(filter || '').toLowerCase()

  let mediaArgs = 'type: ANIME, sort: SCORE_DESC'
  if (f === 'bypopularity') mediaArgs = 'type: ANIME, sort: POPULARITY_DESC'
  else if (f === 'airing') mediaArgs = 'type: ANIME, status: RELEASING, sort: SCORE_DESC'
  else if (f === 'upcoming') mediaArgs = 'type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC'
  else if (['tv', 'movie', 'ova', 'special', 'ona', 'music'].includes(f)) {
    mediaArgs = `type: ANIME, format: ${f.toUpperCase()}, sort: SCORE_DESC`
  }

  const query = `query ($page: Int, $perPage: Int) {
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

  const data = await anilistRequest(query, { page: safePage, perPage: safeLimit })
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

/** Jikan-shaped /anime?letter=X list from AniList (Jikan is often down).
 *  AniList has no native "starts-with" filter — its `search` is fuzzy
 *  (searching "b" can surface titles with b anywhere). So we fetch a
 *  SEARCH_MATCH pool and keep ONLY entries whose romaji/english title
 *  genuinely starts with the letter, then serve it Jikan-shaped with
 *  working pagination. Truthful subset > misleading full list.
 */
export async function getAnimeByLetterFromAniList(letter = '', page = 1, limit = 24) {
  const safePage = Math.max(1, Number.isFinite(page) ? page : 1)
  const safeLimit = Math.max(1, Math.min(50, Number.isFinite(limit) ? limit : 24))
  const ch = String(letter || '').trim().charAt(0).toLowerCase()
  if (!ch || !/[a-z]/.test(ch)) {
    throw new Error('Invalid letter')
  }

  const query = `query ($q: String, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage currentPage lastPage total }
      media(search: $q, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {
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

  // AniList search is relevance-ranked, not alphabetical — and for a single
  // letter the top page is still dominated by genuine prefix matches. Pull a
  // pool of up to 4 pages (200 candidates, well under the per-letter fuzzy
  // result depth for common letters), keep only true prefix matches, sort
  // alphabetically, then slice for the requested Jikan page.
  const wanted = safePage * safeLimit + 1
  const matched = []
  const seen = new Set()
  for (let alPage = 1; alPage <= 4 && matched.length < wanted; alPage++) {
    let data
    try {
      data = await anilistRequest(query, { q: ch, page: alPage, perPage: 50 })
    } catch (e) {
      // Graceful degradation: if AniList rate-limits mid-pool (429) but we
      // ALREADY collected enough prefix matches to serve the requested page
      // (or at least page 1 of a sparse letter), return the partial pool
      // rather than failing the whole request — a truthful subset beats a 502.
      // Only hard-fail when the requested page has zero matches to show.
      if (matched.length >= (safePage - 1) * safeLimit + 1) break
      throw e
    }
    if (data?.errors?.length) {
      throw new Error(data.errors[0]?.message || 'AniList GraphQL error')
    }
    const media = data?.data?.Page?.media || []
    if (!media.length) break
    for (const m of media) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      const romaji = (m.title?.romaji || '').toLowerCase()
      const english = (m.title?.english || '').toLowerCase()
      if (romaji.startsWith(ch) || english.startsWith(ch)) matched.push(m)
    }
    const pageInfo = data?.data?.Page?.pageInfo
    if (!pageInfo?.hasNextPage) break
  }

  // An EMPTY result is never truthful for a letter browse on a healthy
  // upstream — every letter has titles, so zero prefix matches across a
  // 200-candidate pool means the upstream throttled or returned junk.
  // Throw instead of returning an empty success: the proxy then fails
  // this request (502 + short negative cache → retryable) instead of
  // caching a sticky "No anime found starting with X" for 10 minutes.
  if (!matched.length) {
    throw new Error('AniList letter fallback returned no prefix matches — upstream throttled or unavailable')
  }

  matched.sort((a, b) => {
    const ta = (a.title?.english || a.title?.romaji || '').toLowerCase()
    const tb = (b.title?.english || b.title?.romaji || '').toLowerCase()
    return ta.localeCompare(tb)
  })

  const start = (safePage - 1) * safeLimit
  const slice = matched.slice(start, start + safeLimit)
  return {
    data: slice.map(mapMedia),
    pagination: {
      has_next_page: matched.length > start + safeLimit,
      current_page: safePage,
      last_visible_page: Math.max(1, Math.ceil(matched.length / safeLimit)),
      items: { count: slice.length, total: matched.length, per_page: safeLimit },
    },
  }
}

/**
 * Route-level dispatcher: try to satisfy a Jikan-style request from AniList
 * when Jikan itself is down or returns a 504. Returns Jikan-shaped data for
 * /anime search, /anime/:id, and /top/anime endpoints, or null for
 * unsupported paths.
 */
export async function tryAniListFallback(targetPath, query) {
  const page = Math.max(1, Number.isFinite(Number(query.page)) ? Number(query.page) : 1)
  const limit = Math.max(1, Number.isFinite(Number(query.limit)) ? Number(query.limit) : 24)

  // Express can turn repeated query params into arrays; only use the first value.
  const rawQ = Array.isArray(query.q) ? query.q[0] : query.q

  if (targetPath === '/anime') {
    // /anime?letter=X is the A–Z catalog browse — needs a DIFFERENT fallback
    // than plain search. The generic path (searchAniListAsJikan with no q)
    // would silently return a popularity list, mislabeling it as letter X.
    const rawLetter = Array.isArray(query.letter) ? query.letter[0] : query.letter
    if (rawLetter) {
      return await getAnimeByLetterFromAniList(String(rawLetter), page, limit)
    }
    return await searchAniListAsJikan(rawQ ? String(rawQ) : undefined, page, limit)
  }

  if (targetPath === '/top/anime') {
    const rawFilter = Array.isArray(query.filter) ? query.filter[0] : query.filter
    return await getTopAnimeFromAniList(page, limit, rawFilter ? String(rawFilter) : '')
  }

  const animeIdMatch = targetPath.match(/^\/anime\/(\d+)(?:\/full)?$/)
  if (animeIdMatch) {
    return await getAniListAnimeByMalAsJikan(Number(animeIdMatch[1]))
  }

  return null
}
