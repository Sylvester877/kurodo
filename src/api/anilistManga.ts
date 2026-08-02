// AniList GraphQL — Manga-specific queries.
// Extends anilist.ts with manga discovery, detail, and coloured-edition
// parent resolution (e.g. "Naruto Coloured" → tracks as "Naruto").

import { anilistRequest } from './anilistClient'

// ── Shared caching (same pattern as anilist.ts) ──
const cache = new Map<string, { at: number; value: unknown }>()
const TTL = 30 * 60 * 1000
const CACHE_MAX = 300
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

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface MangaFeedMedia {
  id: number
  idMal: number | null
  title: { romaji: string; english: string | null; native: string | null }
  coverImage: { extraLarge: string | null; large: string | null; color: string | null }
  bannerImage: string | null
  chapters: number | null
  volumes: number | null
  averageScore: number | null
  popularity: number | null
  format: string | null
  status: string | null
  genres: string[]
  description: string | null
  startDate: { year: number | null; month: number | null; day: number | null } | null
}

export interface MangaDetail extends MangaFeedMedia {
  relations: {
    edges: Array<{
      relationType: string
      node: {
        id: number
        idMal: number | null
        title: { romaji: string; english: string | null }
        format: string | null
      }
    }>
  }
}

export interface ResolvedManga {
  /** AniList ID of the actual manga to track (parent if this is a coloured edition) */
  anilistId: number
  /** MAL ID of the parent manga (for unified watchlist tracking) */
  malId: number | null
  /** The original (non-coloured) title */
  parentTitle: string | null
  /** Whether this is a coloured/special edition */
  isColoured: boolean
  /** The display title (may be the coloured edition title) */
  displayTitle: string
  /** Full manga detail */
  detail: MangaDetail
}

/** Paginated manga search result (mirrors AnimeSearchResponse shape). */
export interface MangaSearchResult {
  data: MangaFeedMedia[]
  pagination: {
    last_visible_page: number
    has_next_page: boolean
    items: { count: number; total: number; per_page: number }
    current_page: number
  }
}

// ── Media fields shared across manga queries ──
const MANGA_FIELDS = `
  id idMal
  title { romaji english native }
  coverImage { extraLarge large color }
  bannerImage
  chapters volumes averageScore popularity format status genres
  description(asHtml: false)
  startDate { year month day }
`

// ═══════════════════════════════════════════════════════════════
// Queries
// ═══════════════════════════════════════════════════════════════

/** Search manga by title via AniList (metadata only — no chapters/images). */
export async function searchMangaAniList(query_: string, perPage = 24): Promise<MangaFeedMedia[]> {
  const data = await query<{ Page: { media: MangaFeedMedia[] } }>(
    `query ($q: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $q, type: MANGA, sort: SEARCH_MATCH) {
          ${MANGA_FIELDS}
        }
      }
    }`,
    { q: query_, perPage },
  )
  return data.Page.media
}

/**
 * Paginated manga search via AniList.
 * Returns a MangaSearchResult mirroring the anime AnimeSearchResponse shape
 * so the Search page can reuse its pagination/infinite-scroll logic.
 */
export async function searchMangaAniListPaginated(
  query_: string,
  page = 1,
  perPage = 24,
): Promise<MangaSearchResult> {
  const data = await query<{
    Page: { media: MangaFeedMedia[]; pageInfo: { total: number; perPage: number; currentPage: number; lastPage: number; hasNextPage: boolean } }
  }>(
    `query ($q: String, $page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(search: $q, type: MANGA, sort: SEARCH_MATCH) {
          ${MANGA_FIELDS}
        }
        pageInfo { total perPage currentPage lastPage hasNextPage }
      }
    }`,
    { q: query_, page, perPage },
  )
  const info = data.Page.pageInfo
  return {
    data: data.Page.media,
    pagination: {
      last_visible_page: info.lastPage,
      has_next_page: info.hasNextPage,
      items: { count: info.total, total: info.total, per_page: info.perPage },
      current_page: info.currentPage,
    },
  }
}

/** Trending manga. */
export const getTrendingManga = (perPage = 24) =>
  query<{ Page: { media: MangaFeedMedia[] } }>(
    `query ($perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(type: MANGA, sort: TRENDING_DESC, status_in: [RELEASING, FINISHED]) {
          ${MANGA_FIELDS}
        }
      }
    }`,
    { perPage },
  ).then((d) => d.Page.media)

/** Popular manga (all time). */
export const getPopularManga = (perPage = 24) =>
  query<{ Page: { media: MangaFeedMedia[] } }>(
    `query ($perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(type: MANGA, sort: SCORE_DESC, status_in: [FINISHED, RELEASING]) {
          ${MANGA_FIELDS}
        }
      }
    }`,
    { perPage },
  ).then((d) => d.Page.media)

/** Get manga detail by AniList ID. */
export async function getMangaByAniListId(anilistId: number): Promise<MangaDetail | null> {
  const data = await query<{ Media: MangaDetail | null }>(
    `query ($id: Int) {
      Media(id: $id, type: MANGA) {
        ${MANGA_FIELDS}
        relations {
          edges {
            relationType
            node {
              id idMal
              title { romaji english }
              format
            }
          }
        }
      }
    }`,
    { id: anilistId },
  )
  return data.Media
}

/** Get manga detail by MAL ID via AniList. */
export async function getMangaByMalId(malId: number): Promise<MangaDetail | null> {
  const data = await query<{ Media: MangaDetail | null }>(
    `query ($malId: Int) {
      Media(idMal: $malId, type: MANGA) {
        ${MANGA_FIELDS}
        relations {
          edges {
            relationType
            node {
              id idMal
              title { romaji english }
              format
            }
          }
        }
      }
    }`,
    { malId },
  )
  return data.Media
}

/**
 * Resolve a manga — handles coloured editions by tracing relations
 * back to the parent (source) manga.
 *
 * For example, "Naruto Coloured Edition" has a SOURCE relation to
 * "Naruto" — we resolve the parent and use its MAL ID for unified
 * tracking in the watchlist.
 */
export async function resolveManga(anilistOrMalId: number, by: 'anilist' | 'mal' = 'anilist'): Promise<ResolvedManga | null> {
  const detail = by === 'anilist'
    ? await getMangaByAniListId(anilistOrMalId)
    : await getMangaByMalId(anilistOrMalId)

  if (!detail) return null

  const title = detail.title.english || detail.title.romaji || ''
  const isColoured = /colou?r(ed)?/i.test(title) ||
    /full.?colou?r/i.test(title) ||
    detail.format === 'SPECIAL'

  if (!isColoured) {
    return {
      anilistId: detail.id,
      malId: detail.idMal,
      parentTitle: null,
      isColoured: false,
      displayTitle: title,
      detail,
    }
  }

  // Find the SOURCE (parent) relation
  const sourceEdge = (detail.relations?.edges || []).find(
    (e) => e.relationType === 'SOURCE' || e.relationType === 'PARENT',
  )

  if (sourceEdge?.node) {
    const parent = await getMangaByAniListId(sourceEdge.node.id)
    const parentTitle = parent?.title.english || parent?.title.romaji ||
      sourceEdge.node.title.english || sourceEdge.node.title.romaji || title
    return {
      anilistId: sourceEdge.node.id,
      malId: sourceEdge.node.idMal ?? parent?.idMal ?? null,
      parentTitle,
      isColoured: true,
      displayTitle: title,
      detail: parent || detail,
    }
  }

  // No parent found — treat as standalone
  return {
    anilistId: detail.id,
    malId: detail.idMal,
    parentTitle: null,
    isColoured: true,
    displayTitle: title,
    detail,
  }
}

/** Get the AniList ID for a MAL manga ID. */
export async function getMangaAniListId(malId: number): Promise<number | null> {
  const data = await query<{ Media: { id: number } | null }>(
    `query ($malId: Int) {
      Media(idMal: $malId, type: MANGA) { id }
    }`,
    { malId },
  )
  return data.Media?.id ?? null
}
