// Atsu.moe provider — alternative manga source with full catalog.
// Uses atsu.moe's internal REST API (reverse-engineered, no auth required).
// Endpoints: /api/manga/page, /api/manga/allChapters, /api/read/chapter,
//            /collections/manga/documents/search (Typesense)

import axios from 'axios'

const BASE = 'https://atsu.moe'

const api = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: {
    'User-Agent': 'Kurodo/0.1 (manga-reader)',
    'Accept': 'application/json',
    'Referer': BASE,
  },
})

// Coerce a value that might be a string, an object like {url}, or an array
// into a flat string URL. atsu.moe's API occasionally returns relative paths
// as objects, which would throw on string methods (.startsWith, etc.).
function coerceUrlLike(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return coerceUrlLike(value[0])
  if (typeof value === 'object') {
    if (typeof value.url === 'string') return value.url
    if (typeof value.src === 'string') return value.src
    if (typeof value.path === 'string') return value.path
  }
  return ''
}

// Resolve an atsu.moe-relative path against BASE. Returns absolute URL or
// absolutized URL (whichever the upstream gave us).
function absolutize(url) {
  const u = coerceUrlLike(url)
  if (!u) return null
  if (u.startsWith('http')) return u
  if (u.startsWith('//')) return `https:${u}`
  return `${BASE}${u.startsWith('/') ? u : `/${u}`}`
}

// Simple in-memory cache
const cache = new Map()
const TTL = 10 * 60 * 1000 // 10 min
const SEARCH_TTL = 5 * 60 * 1000 // 5 min
const PAGES_TTL = 30 * 60 * 1000 // 30 min

function cached(key, ttl, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value
  if (hit && hit.pending) return hit.pending
  const promise = fn().then((value) => {
    cache.set(key, { at: Date.now(), value })
    return value
  }).catch((e) => {
    cache.delete(key)
    throw e
  })
  cache.set(key, { at: Date.now(), pending: promise })
  return promise
}

// ── Normalize search result ──
function normalizeSearchResult(doc) {
  // poster is a relative path like "/static/posters/xxx.jpg", or sometimes
  // an object like { url: "..." } depending on the API variant.
  const poster = coerceUrlLike(doc.poster || doc.posterMedium)
  const coverUrl = absolutize(poster)
  return {
    id: doc.id,
    title: doc.title || doc.englishTitle || 'Unknown',
    englishTitle: doc.englishTitle || null,
    synopsis: doc.synopsis || '',
    status: doc.status || 'unknown',
    year: doc.year || null,
    chapterCount: doc.chapterCount || null,
    coverUrl,
    authors: doc.authors || [],
    format: doc.type || null,
  }
}

// ── Normalize manga detail ──
function normalizeMangaInfo(data) {
  const manga = data.mangaPage || data || {}
  const coverUrl = absolutize(manga.poster)
  const bannerUrl = absolutize(manga.banner?.url ?? manga.banner)
  return {
    id: manga.id,
    title: manga.title || '',
    englishTitle: manga.englishTitle || null,
    synopsis: manga.synopsis || '',
    status: manga.status || '',
    year: manga.released ? new Date(manga.released).getFullYear() : null,
    chapterCount: manga.chapterCount || null,
    coverUrl,
    bannerUrl,
    authors: manga.authors || [],
    genres: manga.genres || [],
    scanlators: manga.scanlators || [],
  }
}

// ── Normalize chapter ──
function normalizeChapter(ch) {
  return {
    id: ch.id,
    chapter: String(ch.number ?? ch.chapter ?? '0'),
    title: ch.title || null,
    index: ch.index || 0,
    pageCount: ch.pageCount || 0,
    createdAt: ch.createdAt || null,
    scanGroup: ch.scanlationGroup?.name || null,
  }
}

// ── Normalize page ──
function normalizePage(p) {
  return {
    id: p.id,
    url: absolutize(p.image),
    number: p.number,
    width: p.width || 0,
    height: p.height || 0,
    aspectRatio: p.aspectRatio || 0,
  }
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Search manga by title via Typesense.
 * GET /collections/manga/documents/search?q={q}&query_by=title&per_page={limit}&page={page}
 */
export async function searchManga(query, { limit = 24, offset = 0 } = {}) {
  const page = Math.floor(offset / limit) + 1
  const key = `atsu:search:${query}:${limit}:${page}`
  return cached(key, SEARCH_TTL, async () => {
    const params = {
      q: query,
      query_by: 'title,englishTitle',
      sort_by: '_text_match:desc',
      per_page: limit,
      page,
    }
    const { data } = await api.get('/collections/manga/documents/search', { params })
    const hits = data.hits || []
    return {
      results: hits.map((h) => normalizeSearchResult(h.document || h)),
      total: data.found || 0,
      offset,
      limit,
    }
  })
}

/**
 * Get manga detail.
 * GET /api/manga/page?id={id}
 */
export async function getMangaInfo(atsuId) {
  const key = `atsu:manga:${atsuId}`
  return cached(key, TTL, async () => {
    const { data } = await api.get('/api/manga/page', { params: { id: atsuId } })
    return normalizeMangaInfo(data)
  })
}

/**
 * Get all chapters for a manga.
 * GET /api/manga/allChapters?mangaId={id}
 */
export async function getChapterFeed(atsuId) {
  const key = `atsu:feed:${atsuId}`
  return cached(key, 5 * 60 * 1000, async () => {
    const { data } = await api.get('/api/manga/allChapters', { params: { mangaId: atsuId } })
    const chapters = (data.chapters || []).map(normalizeChapter)
    return {
      chapters,
      total: chapters.length,
    }
  })
}

/**
 * Get chapter pages.
 * GET /api/read/chapter?mangaId={mangaId}&chapterId={chapterId}
 */
export async function getChapterPages(mangaId, chapterId) {
  const key = `atsu:pages:${mangaId}:${chapterId}`
  return cached(key, PAGES_TTL, async () => {
    const { data } = await api.get('/api/read/chapter', { params: { mangaId, chapterId } })
    const readChapter = data.readChapter || {}
    const pages = (readChapter.pages || []).map(normalizePage)
    return { pages }
  })
}

// Re-export for provider-style usage
export const atsuProvider = {
  name: 'atsu',
  searchManga,
  getMangaInfo,
  getChapterFeed,
  getChapterPages,
}
