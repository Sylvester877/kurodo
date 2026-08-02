// AniList GraphQL — used to map MAL ID ↔ AniList ID (needed for AniZip + anidap).
// Free, no auth required, ~90 req/min rate limit.

import type { Anime, AnimeSearchResponse } from '../types'
import { anilistRequest } from './anilistClient'


const cache = new Map<string, { at: number; value: unknown }>()
const TTL = 30 * 60 * 1000 // 30 min — AniList IDs don't change
const CACHE_MAX = 300 // bound memory — evict oldest beyond this

// In-flight dedup: identical concurrent queries (e.g. the same media looked
// up from multiple components on one render) share a single network request.
const inflight = new Map<string, Promise<unknown>>()

async function query<T>(gql: string, variables: Record<string, unknown>): Promise<T> {
  const key = gql + JSON.stringify(variables)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value as T

  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>

  const promise = anilistRequest<T>(gql, variables)
    .then((value) => {
      cache.set(key, { at: Date.now(), value })
      // Evict the oldest entry once we exceed the cap (Map preserves
      // insertion order, so the first key is the oldest).
      if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      return value
    })
    .finally(() => { inflight.delete(key) })

  inflight.set(key, promise)
  return promise
}

// ---------- MAL → AniList ID ----------
export async function getAniListIdFromMal(malId: number): Promise<number | null> {
  const data = await query<{ Media: { id: number } | null }>(
    `query ($malId: Int) {
      Media(idMal: $malId, type: ANIME) { id }
    }`,
    { malId },
  )
  return data.Media?.id ?? null
}

/**
 * One-shot lookup of an AniList media's total episode count.
 * Used by sync.ts to know when a user has finished a show (so we can
 * auto-flip their AniList status from CURRENT → COMPLETED).
 */
export async function fetchMediaCounts(anilistId: number): Promise<number | null> {
  try {
    const data = await query<{ Media: { episodes: number | null } | null }>(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) { episodes }
      }`,
      { id: anilistId },
    )
    return data.Media?.episodes ?? null
  } catch {
    return null
  }
}

// ---------- Compact lookup: AniList ID + episode caps in one query ----------
export interface AniListEpisodeInfo {
  anilistId: number | null
  /** Total episodes per AniList (more accurate than Jikan for ongoing shows). */
  totalEpisodes: number | null
  /** Latest aired episode. Null if completed (then totalEpisodes applies). */
  airedThrough: number | null
  /** Next-airing episode number + UNIX timestamp (s). Null if not airing. */
  nextAiring: { episode: number; airingAt: number } | null
  /** coverImage.color hex — drives the dynamic aura on the Watch page. */
  accentColor: string | null
  /** Wide cinematic banner (1920×600) — per-anime background on Watch page. */
  bannerImage: string | null
  /** Extra-large cover for fallback when no banner exists. */
  coverImageLarge: string | null
}

export async function getEpisodeInfoFromMal(malId: number): Promise<AniListEpisodeInfo> {
  try {
    const data = await query<{
      Media: {
        id: number
        episodes: number | null
        status: string | null
        bannerImage: string | null
        coverImage: { color: string | null; extraLarge: string | null; large: string | null }
        nextAiringEpisode: { episode: number; airingAt: number } | null
      } | null
    }>(
      `query ($malId: Int) {
        Media(idMal: $malId, type: ANIME) {
          id episodes status
          bannerImage
          coverImage { color extraLarge large }
          nextAiringEpisode { episode airingAt }
        }
      }`,
      { malId },
    )
    const m = data.Media
    if (!m) {
      return { anilistId: null, totalEpisodes: null, airedThrough: null, nextAiring: null, accentColor: null, bannerImage: null, coverImageLarge: null }
    }
    // If a "next" episode is announced, everything before it has aired.
    const aired = m.nextAiringEpisode
      ? Math.max(0, m.nextAiringEpisode.episode - 1)
      : null
    return {
      anilistId: m.id,
      totalEpisodes: m.episodes,
      airedThrough: aired,
      nextAiring: m.nextAiringEpisode
        ? { episode: m.nextAiringEpisode.episode, airingAt: m.nextAiringEpisode.airingAt }
        : null,
      accentColor: m.coverImage?.color ?? null,
      bannerImage: m.bannerImage ?? null,
      coverImageLarge: m.coverImage?.extraLarge || m.coverImage?.large || null,
    }
  } catch {
    return { anilistId: null, totalEpisodes: null, airedThrough: null, nextAiring: null, accentColor: null, bannerImage: null, coverImageLarge: null }
  }
}

// ---------- Richer metadata (optional, nice for Watch page banner) ----------
export interface AniListMedia {
  id: number
  idMal: number | null
  title: { romaji: string; english: string | null; native: string | null }
  description: string | null
  bannerImage: string | null
  coverImage: { extraLarge: string | null; large: string | null; color: string | null }
  episodes: number | null
  duration: number | null
  averageScore: number | null
  genres: string[]
  studios: { nodes: { name: string }[] }
  trailer: { id: string; site: string } | null
  nextAiringEpisode: { episode: number; airingAt: number } | null
}

// ---------- Airing schedule (next 7 days) ----------
export interface AiringSchedule {
  id: number
  episode: number
  airingAt: number
  timeUntilAiring: number
  media: {
    id: number
    idMal: number | null
    title: { romaji: string; english: string | null; native: string | null }
    coverImage: { large: string | null; color: string | null }
    bannerImage: string | null
    format: string | null
    averageScore: number | null
    episodes: number | null
    duration: number | null
    genres: string[]
  }
}

export async function getAiringSchedule(
  fromUnix: number,
  toUnix: number,
  page = 1,
  perPage = 50,
): Promise<{ items: AiringSchedule[]; hasNextPage: boolean }> {
  const data = await query<{
    Page: {
      pageInfo: { hasNextPage: boolean }
      airingSchedules: AiringSchedule[]
    }
  }>(
    `query ($from: Int, $to: Int, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
          id episode airingAt timeUntilAiring
          media {
            id idMal
            title { romaji english native }
            coverImage { large color }
            bannerImage
            format averageScore episodes duration genres
          }
        }
      }
    }`,
    { from: fromUnix, to: toUnix, page, perPage },
  )
  return {
    items: data.Page.airingSchedules,
    hasNextPage: data.Page.pageInfo.hasNextPage,
  }
}

// ─────────────────────────────────────────────────────────────────
// Homepage feeds — much faster than Jikan, no rate-limit gymnastics.
// ─────────────────────────────────────────────────────────────────

export interface FeedMedia {
  id: number
  idMal: number | null
  title: { romaji: string; english: string | null; native: string | null }
  coverImage: { extraLarge: string | null; large: string | null; color: string | null }
  bannerImage: string | null
  episodes: number | null
  duration: number | null
  averageScore: number | null
  /** Community popularity score (number of users with this on a list). */
  popularity: number | null
  format: string | null
  status: string | null
  season: string | null
  seasonYear: number | null
  genres: string[]
  /** Main animation studio nodes — first is treated as primary. */
  studios: { nodes: { name: string }[] }
  nextAiringEpisode: { episode: number; airingAt: number } | null
  description: string | null
  trailer: { id: string; site: string } | null
}

const MEDIA_FIELDS = `
  id idMal
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  episodes duration averageScore popularity format status season seasonYear genres
  studios(isMain: true) { nodes { name } }
  nextAiringEpisode { episode airingAt }
  description(asHtml: false)
  trailer { id site }
`

async function pageQuery(filter: string, perPage = 24): Promise<FeedMedia[]> {
  const data = await query<{ Page: { media: FeedMedia[] } }>(
    `query ($perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(type: ANIME, ${filter}) { ${MEDIA_FIELDS} }
      }
    }`,
    { perPage },
  )
  return data.Page.media
}

/** Currently trending. Replaces "top rated" as the headline row. */
export const getTrending = (perPage = 24) =>
  pageQuery('sort: TRENDING_DESC, status_in: [RELEASING, FINISHED]', perPage)

/** This season's airing shows, ordered by popularity. */
export const getThisSeason = (perPage = 24) =>
  pageQuery('status: RELEASING, sort: POPULARITY_DESC', perPage)

/** Anime that air this week, ordered by score (the "current hits"). */
export const getPopularAiring = (perPage = 24) =>
  pageQuery('status: RELEASING, sort: SCORE_DESC', perPage)

/** Upcoming next season. */
export const getUpcoming = (perPage = 24) =>
  pageQuery('status: NOT_YET_RELEASED, sort: POPULARITY_DESC', perPage)

/** All-time top rated (the classics). */
export const getAllTimeTop = (perPage = 24) =>
  pageQuery('sort: SCORE_DESC, status_in: [FINISHED, RELEASING]', perPage)

/**
 * Latest episodes that aired recently — the anidap-style "Recent Episodes" row.
 * Returns 1 entry per show with the episode number that just dropped.
 */
export interface RecentEpisode {
  media: FeedMedia
  episode: number
  airedAt: number
}

export async function getRecentEpisodes(perPage = 18): Promise<RecentEpisode[]> {
  const nowSec = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = nowSec - 7 * 24 * 60 * 60
  const data = await query<{
    Page: {
      airingSchedules: Array<{
        episode: number
        airingAt: number
        media: FeedMedia
      }>
    }
  }>(
    `query ($from: Int, $to: Int, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        airingSchedules(
          airingAt_greater: $from
          airingAt_lesser: $to
          sort: TIME_DESC
        ) {
          episode airingAt
          media { ${MEDIA_FIELDS} }
        }
      }
    }`,
    { from: sevenDaysAgo, to: nowSec, perPage },
  )
  // Dedupe: keep only the latest episode per show
  const seen = new Set<number>()
  const result: RecentEpisode[] = []
  for (const item of data.Page.airingSchedules) {
    if (!item.media || seen.has(item.media.id)) continue
    seen.add(item.media.id)
    result.push({ media: item.media, episode: item.episode, airedAt: item.airingAt })
  }
  return result
}

/** Convert a raw AniList media object into the Jikan-shaped `Anime` used by the UI. */
function mapAniListMediaToAnime(m: any): Anime {
  const cover =
    m.coverImage?.extraLarge || m.coverImage?.large || m.bannerImage || ''
  const title = m.title?.english || m.title?.romaji || ''
  return {
    mal_id: (m.idMal ?? m.id) as number,
    title,
    title_english: m.title?.english ?? null,
    title_japanese: m.title?.native ?? null,
    synopsis: m.description ? m.description.replace(/<[^>]+>/g, '') : null,
    score: m.averageScore ? m.averageScore / 10 : null,
    scored_by: null,
    rank: null,
    popularity: m.popularity ?? null,
    members: null,
    favorites: null,
    images: {
      jpg: {
        image_url: cover,
        small_image_url: cover,
        large_image_url: cover,
      },
      webp: {
        image_url: cover,
        small_image_url: cover,
        large_image_url: cover,
      },
    },
    trailer: {
      youtube_id: m.trailer?.id ?? null,
      url: m.trailer?.id ? `https://www.youtube.com/watch?v=${m.trailer.id}` : null,
      embed_url: m.trailer?.id ? `https://www.youtube.com/embed/${m.trailer.id}` : null,
      images: {
        image_url: null,
        small_image_url: null,
        medium_image_url: null,
        large_image_url: null,
        maximum_image_url: null,
      },
    },
    type: m.format ?? '',
    status:
      m.status === 'RELEASING'
        ? 'Currently Airing'
        : m.status === 'FINISHED'
          ? 'Finished Airing'
        : m.status === 'NOT_YET_RELEASED'
          ? 'Not yet aired'
        : m.status === 'CANCELLED'
          ? 'Cancelled'
        : m.status === 'HIATUS'
          ? 'On Hiatus'
          : m.status ?? '',
    episodes: m.episodes ?? null,
    duration: m.duration ? `${m.duration} min` : null,
    rating: null,
    aired: { from: null, to: null, string: null },
    season: m.season ?? null,
    year: m.seasonYear ?? null,
    genres: (m.genres || []).map((g: string) => ({ mal_id: 0, name: g })),
    studios: (m.studios?.nodes || []).map((n: any) => ({ mal_id: 0, name: n.name })),
    themes: [],
    demographics: [],
  }
}

export async function getAniListMediaByMalId(malId: number): Promise<Anime | null> {
  const data = await query<{ Media: any | null }>(
    `query ($malId: Int) {
      Media(idMal: $malId, type: ANIME) {
        id idMal
        title { romaji english native }
        description(asHtml: false)
        bannerImage
        coverImage { extraLarge large color }
        episodes duration averageScore popularity format status season seasonYear genres
        studios(isMain: true) { nodes { name } }
        trailer { id site }
        nextAiringEpisode { episode airingAt }
      }
    }`,
    { malId },
  )
  if (!data.Media) return null
  const mapped = mapAniListMediaToAnime(data.Media)
  // Ensure the returned anime carries the MAL ID we asked for, so downstream
  // code keyed on mal_id (URL params, watchlist, etc.) stays consistent.
  mapped.mal_id = malId
  return mapped
}

export async function searchAnimeAniList(
  q: string,
  page = 1,
  perPage = 24,
): Promise<AnimeSearchResponse> {
  const data = await query<{
    Page: {
      pageInfo: { hasNextPage: boolean; currentPage: number; lastPage: number }
      media: any[]
    }
  }>(
    `query ($q: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage currentPage lastPage }
        media(search: $q, type: ANIME, sort: SEARCH_MATCH) {
          id idMal
          title { romaji english native }
          description(asHtml: false)
          bannerImage
          coverImage { extraLarge large color }
          episodes duration averageScore popularity format status season seasonYear genres
          studios(isMain: true) { nodes { name } }
          trailer { id site }
          nextAiringEpisode { episode airingAt }
        }
      }
    }`,
    { q, page, perPage },
  )
  const mapped = data.Page.media.map(mapAniListMediaToAnime)
  return {
    data: mapped,
    pagination: {
      has_next_page: data.Page.pageInfo.hasNextPage,
      current_page: data.Page.pageInfo.currentPage,
      last_visible_page: data.Page.pageInfo.lastPage,
      items: {
        count: mapped.length,
        total: mapped.length,
        per_page: perPage,
      },
    },
  }
}

export async function getAniListMedia(anilistId: number): Promise<AniListMedia | null> {
  const data = await query<{ Media: AniListMedia | null }>(
    `query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id idMal
        title { romaji english native }
        description(asHtml: false)
        bannerImage
        coverImage { extraLarge large color }
        episodes duration averageScore genres
        studios(isMain: true) { nodes { name } }
        trailer { id site }
        nextAiringEpisode { episode airingAt }
      }
    }`,
    { id: anilistId },
  )
  return data.Media
}

// ─────────────────────────────────────────────────────────────────
// Public user list — no auth, username-based import
// ─────────────────────────────────────────────────────────────────

import type { ListStatus } from './anilistAuth'

export interface PublicAniListEntry {
  status: ListStatus
  progress: number
  score: number
  media: {
    id: number
    idMal: number | null
    title: { romaji: string; english: string | null }
    episodes: number | null
  }
}

/**
 * Fetch a public AniList user's anime list by username.
 * No auth required — AniList's GraphQL allows public reads.
 * Private accounts return a "Private User" error that we surface.
 */
export async function getUserAnimeList(userName: string): Promise<PublicAniListEntry[]> {
  const { anilistRequest: ar } = await import('./anilistClient')
  const data = await ar<{
    MediaListCollection: {
      lists: { entries: PublicAniListEntry[] }[]
    } | null
  }>(
    `query ($userName: String) {
      MediaListCollection(userName: $userName, type: ANIME) {
        lists {
          entries {
            status progress score
            media {
              id idMal
              title { romaji english }
              episodes
            }
          }
        }
      }
    }`,
    { userName },
  )
  return data.MediaListCollection?.lists?.flatMap((l) => l.entries) ?? []
}

// ─────────────────────────────────────────────────────────────────
// Seasonal timeline — visual calendar grouped by season/year
// ─────────────────────────────────────────────────────────────────

export async function getSeasonal(
  season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL',
  year: number,
  perPage = 30,
): Promise<FeedMedia[]> {
  const data = await query<{ Page: { media: FeedMedia[] } }>(
    `query ($season: MediaSeason, $year: Int, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FIELDS}
        }
      }
    }`,
    { season, year, perPage },
  )
  return data.Page.media
}
