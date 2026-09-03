import axios from 'axios'
import type { Anime, AnimeSearchResponse, AnimeEpisodeResponse, Genre } from '../types'
import { getBackendOrigin } from '../lib/utils'
import { searchAnimeAniList, getAniListMediaByMalId } from './anilist'

// Use /api/jikan proxy on localhost to avoid browser CORS + rate limits.
// In Electron/production, the backend serves the frontend and also proxies
// Jikan, so we still route through /api/jikan for consistent rate-limit handling.
const JIKAN_BASE =
  typeof window !== 'undefined'
    ? `${getBackendOrigin()}/api/jikan`
    : 'https://api.jikan.moe/v4'

const api = axios.create({
  baseURL: JIKAN_BASE,
  timeout: 8000,
})

// ─────────────────────────────────────────────────────────────────
// Request queue: Jikan limit is 3 req/sec, 60 req/min.
// We pace at 150ms (~6 req/sec burst, drops to 3/sec via 429 retry).
// 400ms was WAY too conservative and made first paint 4+ seconds.
// ─────────────────────────────────────────────────────────────────
// Minimal SVG placeholder used when every upstream source fails.
const PLACEHOLDER_IMAGE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 600%22%3E%3Crect width=%22400%22 height=%22600%22 fill=%22%23222%22/%3E%3Ctext x=%22200%22 y=%22300%22 fill=%22%23888%22 text-anchor=%22middle%22 font-size=%2224%22%3ENo Image%3C/text%3E%3C/svg%3E'

const MIN_INTERVAL = 150
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const result = await task()
    await new Promise((r) => setTimeout(r, MIN_INTERVAL))
    return result
  })
  queue = run.catch(() => undefined)
  return run as Promise<T>
}

// ─────────────────────────────────────────────────────────────────
// Two-tier cache:
//   1. Memory (Map) — instant
//   2. localStorage — survives reload, expires after 1 hour
// ─────────────────────────────────────────────────────────────────
const memCache = new Map<string, { at: number; data: unknown }>()
const CACHE_TTL = 60 * 60 * 1000 // 1h memory

/** Sentinel title used when Jikan and AniList are both unavailable. */
export const ANIME_LOAD_STUB_TITLE = 'Unable to load details'
const PERSIST_TTL = 6 * 60 * 60 * 1000 // 6h localStorage
const STORAGE_PREFIX = 'kurodo-cache:'

function loadFromStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; data: T }
    if (Date.now() - parsed.at > PERSIST_TTL) {
      localStorage.removeItem(STORAGE_PREFIX + key)
      return null
    }
    // Never serve cached placeholder stubs — they get saved during Jikan
    // outages and would keep showing grey boxes even after the API recovers.
    const s = JSON.stringify(parsed.data)
    if (s.includes(PLACEHOLDER_IMAGE) || s.includes('Unable to load details')) {
      localStorage.removeItem(STORAGE_PREFIX + key)
      return null
    }
    return parsed.data
  } catch {
    return null
  }
}

function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify({ at: Date.now(), data }),
    )
  } catch {
    // Storage full — clear oldest 25% and try once more
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_PREFIX))
      keys.slice(0, Math.ceil(keys.length / 4)).forEach((k) => localStorage.removeItem(k))
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ at: Date.now(), data }))
    } catch { /* give up */ }
  }
}

// ─────────────────────────────────────────────────────────────────
// In-flight deduplication: if two components ask for the same URL
// at the same time, they share ONE promise instead of two requests.
// ─────────────────────────────────────────────────────────────────
const inFlight = new Map<string, Promise<unknown>>()

async function cachedGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const key = url + '?' + JSON.stringify(params ?? {})

  // 1. Memory hit
  const hit = memCache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data as T

  // 2. localStorage hit — promote to memory
  const persisted = loadFromStorage<T>(key)
  if (persisted) {
    memCache.set(key, { at: Date.now(), data: persisted })
    return persisted
  }

  // 3. Existing in-flight request → share it
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>    // 4. Fresh request
    const p = enqueue(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data } = await api.get<T>(url, { params })
          // Never cache placeholder stubs — they'd poison the cache
          // and show grey boxes even after the upstream API recovers.
          const s = JSON.stringify(data)
          if (!s.includes(PLACEHOLDER_IMAGE) && !s.includes('Unable to load details')) {
            memCache.set(key, { at: Date.now(), data })
            saveToStorage(key, data)
          }
          return data
        } catch (err: unknown) {
        const status = (err as { response?: { status?: number }; code?: string }).response?.status
        const code = (err as { code?: string }).code
        // 429 — rate limited. Wait and retry.
        if (status === 429) {
          await new Promise((r) => setTimeout(r, 1500))
          continue
        }
        // Network error / timeout — wait and retry once.
        if (code === 'ECONNABORTED' || code === 'ERR_NETWORK' || code === 'ERR_BAD_RESPONSE') {
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 1000))
            continue
          }
        }
        throw err
      }
    }
    throw new Error('Request failed after retries')
  })
    .finally(() => inFlight.delete(key))

  inFlight.set(key, p)
  return p
}

// ─────────────────────────────────────────────────────────────────
// Public API (unchanged signatures)
// ─────────────────────────────────────────────────────────────────
export async function getTopAnime(page = 1, limit = 24): Promise<AnimeSearchResponse> {
  return cachedGet<AnimeSearchResponse>('/top/anime', { page, limit })
}

export async function getSeasonalAnime(
  year?: number, season?: string, page = 1, limit = 24,
): Promise<AnimeSearchResponse> {
  const now = new Date()
  const y = year || now.getFullYear()
  const m = now.getMonth()
  let s = season
  if (!s) {
    if (m < 3) s = 'winter'
    else if (m < 6) s = 'spring'
    else if (m < 9) s = 'summer'
    else s = 'fall'
  }
  return cachedGet<AnimeSearchResponse>(`/seasons/${y}/${s}`, { page, limit })
}

export async function getUpcomingAnime(page = 1, limit = 24): Promise<AnimeSearchResponse> {
  return cachedGet<AnimeSearchResponse>('/seasons/upcoming', { page, limit })
}

export async function getAnimeById(id: number): Promise<{ data: Anime }> {
  // Try to use a previously cached Jikan/AniList response first so the UI
  // can paint instantly even when upstream APIs are flaky.
  const cacheKey = `/anime/${id}/full?{}`
  const persisted = loadFromStorage<{ data: Anime }>(cacheKey)

  // Race Jikan vs AniList with a hard cap so the user never waits 30+ s.
  // We return the first source that resolves with real data. If neither
  // source finishes in time, we fall back to stale cache or a stub.
  const jikanPromise = cachedGet<{ data: Anime }>(`/anime/${id}/full`).catch(() => null)
  const anilistPromise = getAniListMediaByMalId(id)
    .then((a) => (a ? ({ data: a }) : null))
    .catch(() => null)

  const raceResult = await new Promise<{ data: Anime } | null>((resolve) => {
    let done = false
    const check = (value: { data: Anime } | null) => {
      if (done) return
      if (value) {
        done = true
        resolve(value)
      }
    }
    jikanPromise.then(check)
    anilistPromise.then(check)
    // When both have settled with no winner, resolve null.
    Promise.allSettled([jikanPromise, anilistPromise]).then(() => {
      if (!done) resolve(null)
    })
    // Hard cap: 8 s total — fail fast so the details/Watch pages never
    // spin for 20+ seconds when upstream (Jikan/AniList) is slow or down.
    setTimeout(() => {
      if (!done) resolve(null)
    }, 8000)
  })
  if (raceResult) return raceResult

  // Last resort: return any cached copy we have so the page still renders.
  if (persisted?.data) {
    console.warn('[getAnimeById] returning stale localStorage fallback', id)
    return persisted
  }

  // Absolute last resort: return a minimal stub so the UI doesn't crash.
  console.error('[getAnimeById] all sources failed, returning stub', id)
  return {
    data: {
      mal_id: id,
      title: ANIME_LOAD_STUB_TITLE,
      title_english: null,
      title_japanese: null,
      synopsis: 'Anime details could not be loaded. Please try again in a moment.',
      score: null,
      scored_by: null,
      rank: null,
      popularity: null,
      members: null,
      favorites: null,
      images: { jpg: { image_url: PLACEHOLDER_IMAGE, small_image_url: PLACEHOLDER_IMAGE, large_image_url: PLACEHOLDER_IMAGE }, webp: { image_url: PLACEHOLDER_IMAGE, small_image_url: PLACEHOLDER_IMAGE, large_image_url: PLACEHOLDER_IMAGE } },
      trailer: { youtube_id: null, url: null, embed_url: null, images: { image_url: null, small_image_url: null, medium_image_url: null, large_image_url: null, maximum_image_url: null } },
      type: '',
      status: 'Unknown',
      episodes: null,
      duration: null,
      rating: null,
      aired: { from: null, to: null, string: null },
      season: null,
      year: null,
      genres: [],
      studios: [],
      themes: [],
      demographics: [],
    } as Anime,
  }
}

export async function getAnimeEpisodes(id: number, page = 1): Promise<AnimeEpisodeResponse> {
  return cachedGet<AnimeEpisodeResponse>(`/anime/${id}/episodes`, { page })
}

export interface SearchFilters {
  /** Jikan `type` — TV / Movie / OVA / Special / ONA / Music */
  format?: string | null
  /** Jikan `season` — winter / spring / summer / fall */
  season?: string | null
  /** Jikan `status` — airing / complete / upcoming */
  status?: string | null
  /** Jikan `genres` — comma-separated MAL genre ids */
  genres?: number[] | null
  /** Jikan `min_score` — 0..10 */
  minScore?: number | null
  /** Jikan `start_date` filter (YYYY) */
  yearFrom?: number | null
  /** Jikan `end_date` filter (YYYY) */
  yearTo?: number | null
  /** Jikan `order_by` — score / popularity / start_date / title / etc. */
  orderBy?: string | null
  /** asc / desc */
  sort?: 'asc' | 'desc' | null
  /** Filter NSFW out via Jikan `sfw=true` */
  sfw?: boolean
}

export async function searchAnime(
  query: string, page = 1, limit = 24,
  filters: SearchFilters = {},
): Promise<AnimeSearchResponse> {
  const params: Record<string, unknown> = {
    q: query,
    page,
    limit,
  }
  if (filters.orderBy != null || filters.sort != null || !query.trim()) {
    params.order_by = filters.orderBy ?? 'score'
    params.sort = filters.sort ?? 'desc'
  }
  if (filters.format) params.type = filters.format
  if (filters.season) params.season = filters.season
  if (filters.status) params.status = filters.status
  if (filters.genres?.length) params.genres = filters.genres.join(',')
  if (filters.minScore != null) params.min_score = filters.minScore
  if (filters.yearFrom != null) params.start_date = `${filters.yearFrom}-01-01`
  if (filters.yearTo != null) params.end_date = `${filters.yearTo}-12-31`
  if (filters.sfw) params.sfw = true

  // Race Jikan vs AniList — return whichever responds first so the user
  // never waits 20s for a slow/504 upstream. Jikan provides richer data
  // (scores, ranks, pagination) but AniList is consistently faster.
  const hasActiveFilters = !!(filters.format || filters.season || filters.status || (filters.genres?.length) || filters.minScore || filters.yearFrom || filters.yearTo)

  if (hasActiveFilters) {
    // Filters only work with Jikan — AniList fallback is title-only.
    try {
      const res = await cachedGet<AnimeSearchResponse>('/anime', params)
      if (res.data && res.data.length > 0) return res
      throw new Error('Jikan returned empty results')
    } catch (err) {
      console.warn('[searchAnime] Jikan filtered search failed, falling back to AniList', err)
      return searchAnimeAniList(query, page, limit)
    }
  }

  // No filters: race Jikan and AniList — first one with data wins.
  return new Promise((resolve) => {
    let settled = false
    const jikanPromise = cachedGet<AnimeSearchResponse>('/anime', params)
      .then((r) => { if (!settled && r.data?.length > 0) { settled = true; resolve(r) } })
      .catch(() => {})
    const anilistPromise = searchAnimeAniList(query, page, limit)
      .then((r) => { if (!settled) { settled = true; resolve(r) } })
      .catch(() => {})
    // 8s hard cap — neither source should take longer than this.
    setTimeout(() => {
      if (!settled) {
        settled = true
        console.warn('[searchAnime] Both sources timed out — returning empty')
        resolve({ data: [], pagination: { last_visible_page: 0, has_next_page: false, current_page: 1, items: { count: 0, total: 0, per_page: limit } } })
      }
    }, 8000)
    // If both promises reject, settle empty.
    Promise.allSettled([jikanPromise, anilistPromise]).then(() => {
      if (!settled) { settled = true; resolve({ data: [], pagination: { last_visible_page: 0, has_next_page: false, current_page: 1, items: { count: 0, total: 0, per_page: limit } } }) }
    })
  })
}

export async function getAnimeGenres(): Promise<{ data: Genre[] }> {
  return cachedGet<{ data: Genre[] }>('/genres/anime', { filter: 'genres' })
}

export async function getAnimeByGenre(
  genreId: number, page = 1, limit = 24,
): Promise<AnimeSearchResponse> {
  return cachedGet<AnimeSearchResponse>('/anime', {
    genres: genreId, page, limit, order_by: 'score', sort: 'desc',
  })
}

export async function getAnimeRecommendations(
  id: number,
): Promise<{ data: { entry: Anime }[] }> {
  // Recommendations are non-critical bottom-of-page content. Jikan's
  // recommendations endpoint is often slow/504, so return empty on failure
  // so the AnimeDetails page isn't held hostage waiting for it.
  try {
    return await cachedGet<{ data: { entry: Anime }[] }>(`/anime/${id}/recommendations`)
  } catch {
    return { data: [] }
  }
}

export async function getPopularAnime(page = 1, limit = 24): Promise<AnimeSearchResponse> {
  return cachedGet<AnimeSearchResponse>('/top/anime', {
    page, limit, filter: 'bypopularity',
  })
}
