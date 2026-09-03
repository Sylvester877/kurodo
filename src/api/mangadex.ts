// MangaDex API frontend client — calls our backend proxy.
// All MangaDex requests go through the server to avoid CORS
// and to benefit from server-side caching.

import axios from 'axios'
import { getBackendOrigin } from '../lib/utils'

const BASE = () => `${getBackendOrigin()}/api/manga`

export interface MangaDexManga {
  id: string
  title: string
  altTitles: Array<Record<string, string>>
  description: string
  status: string
  year: number | null
  contentRating: string
  tags: string[]
  coverUrl: string | null
  /** 512px variant — may 404 upstream; use as first choice with coverUrl fallback. */
  coverThumb: string | null
  lastChapter: string | null
  lastVolume: string | null
}

export interface MangaDexChapter {
  id: string
  chapter: string
  title: string | null
  volume: string | null
  pages: number
  translatedLanguage: string
  publishedAt: string | null
  hash: string | null
  data: string[]
  dataSaver: string[]
  scanGroup: string | null
}

export interface MangaDexPage {
  url: string
  fileName: string
}

export interface MangaDexPages {
  pages: MangaDexPage[]
  dataSaver: MangaDexPage[]
  hash: string
}

export interface SearchResult {
  results: MangaDexManga[]
  total: number
  offset: number
  limit: number
}

export interface BrowseParams {
  genres?: string[]
  format?: string | null
  status?: string[]
  sort?: string
  limit?: number
  offset?: number
}

export interface BrowseTags {
  genres: string[]
  formats: string[]
  statuses: string[]
  sorts: string[]
}

export interface ChapterFeed {
  chapters: MangaDexChapter[]
  total: number
  offset: number
  limit: number
}

/** Search manga on MangaDex by title. */
export async function searchManga(q: string, limit = 24, offset = 0): Promise<SearchResult> {
  const { data } = await axios.get(`${BASE()}/search`, { params: { q, limit, offset } })
  return data.data
}

/** Get latest updated manga. */
export async function getLatestManga(limit = 24, offset = 0): Promise<SearchResult> {
  const { data } = await axios.get(`${BASE()}/latest`, { params: { limit, offset } })
  return data.data
}

/** Get manga detail. */
export async function getMangaInfo(mangaId: string): Promise<MangaDexManga> {
  const { data } = await axios.get(`${BASE()}/info/${mangaId}`)
  return data.data
}

/** Get chapters for a manga. */
export async function getChapterFeed(
  mangaId: string,
  lang = 'en',
  limit = 96,
  offset = 0,
): Promise<ChapterFeed> {
  const { data } = await axios.get(`${BASE()}/chapters/${mangaId}`, {
    params: { lang, limit, offset },
  })
  return data.data
}

/** Get page image URLs for a chapter. */
export async function getChapterPages(chapterId: string): Promise<MangaDexPages> {
  const { data } = await axios.get(`${BASE()}/pages/${chapterId}`)
  return data.data
}

/** Get available browse filter tags (genres, formats, statuses, sorts). */
export async function getBrowseTags(): Promise<BrowseTags> {
  const { data } = await axios.get(`${BASE()}/tags`)
  return data.data
}

/** Browse manga with genre/format/status/sort filters. */
export async function browseManga(params: BrowseParams): Promise<SearchResult> {
  const query: Record<string, string> = {}
  if (params.genres?.length) query.genres = params.genres.join(',')
  if (params.format) query.format = params.format
  if (params.status?.length) query.status = params.status.join(',')
  if (params.sort) query.sort = params.sort
  if (params.limit) query.limit = String(params.limit)
  if (params.offset != null) query.offset = String(params.offset)
  const { data } = await axios.get(`${BASE()}/browse`, { params: query })
  return data.data
}
