// Atsu.moe API frontend client — alternative manga source with full catalog.
// Calls our backend proxy at /api/atsu/* to avoid CORS and benefit from caching.

import axios from 'axios'
import { getBackendOrigin } from '../lib/utils'

const BASE = () => `${getBackendOrigin()}/api/atsu`

export interface AtsuManga {
  id: string
  title: string
  englishTitle: string | null
  synopsis: string
  status: string
  year: number | null
  chapterCount: number | null
  coverUrl: string | null
  bannerUrl: string | null
  authors: string[]
  genres: string[]
  scanlators: string[]
}

export interface AtsuChapter {
  id: string
  chapter: string
  title: string | null
  index: number
  pageCount: number
  createdAt: string | null
  scanGroup: string | null
}

export interface AtsuPage {
  id: string
  url: string
  number: number
  width: number
  height: number
  aspectRatio: number
}

export interface AtsuSearchResult {
  results: AtsuSearchEntry[]
  total: number
  offset: number
  limit: number
}

export interface AtsuSearchEntry {
  id: string
  title: string
  englishTitle: string | null
  synopsis: string
  status: string
  year: number | null
  chapterCount: number | null
  coverUrl: string | null
  authors: string[]
  format: string | null
}

export interface AtsuChapterFeed {
  chapters: AtsuChapter[]
  total: number
}

export interface AtsuPages {
  pages: AtsuPage[]
}

/** Search manga on atsu.moe by title. */
export async function searchManga(q: string, limit = 24, offset = 0): Promise<AtsuSearchResult> {
  const { data } = await axios.get(`${BASE()}/search`, { params: { q, limit, offset } })
  return data.data
}

/** Get manga detail from atsu.moe. */
export async function getMangaInfo(atsuId: string): Promise<AtsuManga> {
  const { data } = await axios.get(`${BASE()}/info/${atsuId}`)
  return data.data
}

/** Get all chapters for a manga from atsu.moe. */
export async function getChapterFeed(atsuId: string): Promise<AtsuChapterFeed> {
  const { data } = await axios.get(`${BASE()}/chapters/${atsuId}`)
  return data.data
}

/** Get page image URLs for a chapter from atsu.moe. */
export async function getChapterPages(atsuId: string, chapterId: string): Promise<AtsuPages> {
  const { data } = await axios.get(`${BASE()}/pages/${atsuId}/${chapterId}`)
  return data.data
}
