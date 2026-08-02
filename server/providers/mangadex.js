// MangaDex API v5 provider — search, manga detail, chapter list, page images.
// Official, free API at https://api.mangadex.org — no scraping needed.
// Docs: https://api.mangadex.org/docs/

import axios from 'axios'

const BASE = 'https://api.mangadex.org'
const UPLOADS = 'https://uploads.mangadex.org'

const api = axios.create({
  baseURL: BASE,
  timeout: 15000,
  headers: {
    'User-Agent': 'Kurodo/0.1 (manga-reader)',
    'Accept': 'application/json',
  },
})

// Simple in-memory cache
const cache = new Map()
const TTL = 10 * 60 * 1000 // 10 min

function cached(key, ttl, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value
  // In-flight dedup
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

// ── Build cover art URL ──
function coverUrl(mangaId, fileName, size = '512') {
  if (!fileName) return null
  const base = fileName.replace(/\.[^.]+$/, '')
  return `${UPLOADS}/covers/${mangaId}/${base}.${size}.jpg`
}

// ── Normalize MangaDex manga object to our shape ──
function normalizeManga(md) {
  const attrs = md.attributes || {}
  const coverRel = (md.relationships || []).find((r) => r.type === 'cover_art')
  const coverFileName = coverRel?.attributes?.fileName || null
  return {
    id: md.id,
    title: attrs.title?.en || Object.values(attrs.title || {})[0] || 'Unknown',
    altTitles: attrs.altTitles || [],
    description: attrs.description?.en || '',
    status: attrs.status || 'unknown',
    year: attrs.year || null,
    contentRating: attrs.contentRating || 'safe',
    tags: (attrs.tags || []).map((t) => t.attributes?.name?.en || ''),
    coverUrl: coverUrl(md.id, coverFileName),
    coverFileName,
    lastChapter: attrs.lastChapter || null,
    lastVolume: attrs.lastVolume || null,
  }
}

// ── Normalize chapter ──
function normalizeChapter(ch) {
  const attrs = ch.attributes || {}
  const scanGroup = (ch.relationships || []).find((r) => r.type === 'scanlation_group')
  return {
    id: ch.id,
    chapter: attrs.chapter || '0',
    title: attrs.title || null,
    volume: attrs.volume || null,
    pages: attrs.pages || 0,
    translatedLanguage: attrs.translatedLanguage || 'en',
    publishedAt: attrs.publishAt || null,
    hash: attrs.hash || null,
    data: attrs.data || [],
    dataSaver: attrs.dataSaver || [],
    scanGroup: scanGroup?.attributes?.name || null,
  }
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Search manga by title.
 * GET /manga?title={q}&limit={n}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive
 */
export async function searchManga(query, { limit = 24, offset = 0 } = {}) {
  const key = `search:${query}:${limit}:${offset}`
  return cached(key, TTL, async () => {
    const params = {
      title: query,
      limit,
      offset,
      'includes[]': 'cover_art',
      'contentRating[]': ['safe', 'suggestive', 'erotica'],
      'order[relevance]': 'desc',
    }
    const { data } = await api.get('/manga', { params })
    return {
      results: (data.data || []).map(normalizeManga),
      total: data.total || 0,
      offset: data.offset || 0,
      limit: data.limit || limit,
    }
  })
}

/**
 * Get manga detail by ID.
 * GET /manga/{id}?includes[]=cover_art
 */
export async function getMangaInfo(mangaId) {
  const key = `manga:${mangaId}`
  return cached(key, TTL, async () => {
    const { data } = await api.get(`/manga/${mangaId}`, {
      params: { 'includes[]': 'cover_art' },
    })
    return normalizeManga(data.data)
  })
}

/**
 * Get chapter feed for a manga.
 * GET /manga/{id}/feed?limit=96&translatedLanguage[]=en&order[chapter]=asc&includes[]=scanlation_group
 */
export async function getChapterFeed(mangaId, { language = 'en', limit = 96, offset = 0 } = {}) {
  const key = `feed:${mangaId}:${language}:${limit}:${offset}`
  return cached(key, 5 * 60 * 1000, async () => {
    const params = {
      limit,
      offset,
      'translatedLanguage[]': language,
      'order[chapter]': 'asc',
      'includes[]': 'scanlation_group',
    }
    const { data } = await api.get(`/manga/${mangaId}/feed`, { params })
    return {
      chapters: (data.data || []).map(normalizeChapter),
      total: data.total || 0,
      offset: data.offset || 0,
      limit: data.limit || limit,
    }
  })
}

/**
 * Get chapter page URLs — the /at-home/server endpoint gives the baseUrl
 * and page filenames needed to construct image URLs.
 * GET /at-home/server/{chapterId}
 */
export async function getChapterPages(chapterId) {
  const key = `pages:${chapterId}`
  return cached(key, 30 * 60 * 1000, async () => {
    const { data } = await api.get(`/at-home/server/${chapterId}`)
    const baseUrl = data.baseUrl
    const hash = data.chapter.hash
    const pages = (data.chapter.data || []).map((fileName) => ({
      url: `${baseUrl}/data/${hash}/${fileName}`,
      fileName,
    }))
    const dataSaver = (data.chapter.dataSaver || []).map((fileName) => ({
      url: `${baseUrl}/data-saver/${hash}/${fileName}`,
      fileName,
    }))
    return {
      pages,
      dataSaver,
      hash,
    }
  })
}

/**
 * Browse latest manga updates.
 * GET /manga?limit=24&order[latestUploadedChapter]=desc&includes[]=cover_art
 */
export async function getLatestManga({ limit = 24, offset = 0 } = {}) {
  const key = `latest:${limit}:${offset}`
  return cached(key, 5 * 60 * 1000, async () => {
    const params = {
      limit,
      offset,
      'includes[]': 'cover_art',
      'contentRating[]': ['safe', 'suggestive'],
      'order[latestUploadedChapter]': 'desc',
    }
    const { data } = await api.get('/manga', { params })
    return {
      results: (data.data || []).map(normalizeManga),
      total: data.total || 0,
      offset: data.offset || 0,
      limit: data.limit || limit,
    }
  })
}

/**
 * Browse popular manga by tag / genre.
 * GET /manga?includedTags[]={tagId}&order[followedCount]=desc
 */
export async function getMangaByTag(tagId, { limit = 24, offset = 0 } = {}) {
  const key = `tag:${tagId}:${limit}:${offset}`
  return cached(key, 10 * 60 * 1000, async () => {
    const params = {
      limit,
      offset,
      'includedTags[]': tagId,
      'includes[]': 'cover_art',
      'contentRating[]': ['safe', 'suggestive'],
      'order[followedCount]': 'desc',
    }
    const { data } = await api.get('/manga', { params })
    return {
      results: (data.data || []).map(normalizeManga),
      total: data.total || 0,
      offset: data.offset || 0,
      limit: data.limit || limit,
    }
  })
}

// ── Genre name → MangaDex tag UUID mapping (stable, from /manga/tag) ──
export const GENRE_MAP = {
  action: '391b0423-d847-456f-aff0-8b0cfc03066b',
  adventure: '87cc87cd-a395-47af-b27a-93258283bbc6',
  'boys-love': 'b11fda93-8fa4-429b-8020-1c5c9fe51d68',
  comedy: '4d32cc48-9f00-4cca-9b5a-a839f0764984',
  crime: '5ca48985-9a9d-4bd8-be29-80dc030bf9ec',
  drama: 'b9af3a63-f058-46de-a9a0-e0c13906197a',
  fantasy: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
  'girls-love': 'a3c67850-4684-404e-9b7f-c69850ee5da6',
  gourmet: '81c836c7-4422-451d-a552-f291527e3b9a',
  horror: 'cdad7e68-6910-41e0-a4dc-83a0d2e1e5a0',
  isekai: 'ace04997-f6bd-436e-b261-216182cc2eab',
  'magical-girls': 'd14322b3-b93b-4d6f-af0d-fbb12db5cbd5',
  mecha: '50880a9f-8aee-47b2-b830-215ff4f31a3b',
  medical: 'c6ace79f-a5dc-4a84-a089-f85b6975595e',
  music: 'f42fbf9e-46f3-48c6-b29f-922f65b20880',
  mystery: '7b29744c-0c50-4e69-bf6e-0725fd3f8326',
  philosophical: 'f8f62932-76da-472f-bd43-8e3f643e3b10',
  psychological: '3b60b75f-2bbf-4b79-8b21-54e1af8e5665',
  romance: '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
  'sci-fi': '256c8f3a-4922-4a32-a1e6-9eaec3765b63',
  'slice-of-life': 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9',
  sports: '69964a64-2f90-4d33-beeb-f3ed2875eb4c',
  supernatural: '5fff4f1f-1e2a-4204-8be3-6f7c1443851e',
  thriller: '07251805-a627-4f2c-96dc-0c79ce67b51d',
  tragedy: '8c86611e-fab7-4986-9dec-d1a2f44acdd5',
  vampires: '2bd2a2c7-32ba-48b4-a8f9-6940c6c4f4b0',
  'martial-arts': '799c202e-7daa-44eb-9cf7-8a3c0449511d',
  'post-apocalyptic': '9467335a-1b83-4497-9231-765337a00b96',
  'reverse-harem': 'a58deb1e-26e6-4271-8dba-7df560aa34be',
  superhero: 'e64f6742-c834-471d-8d72-dd51fc02b835',
  survival: '5fff4f1f-60d9-4a3e-b4a1-f62eb1ea730a',
  zombies: 'cd36b803-3b94-4057-957c-c0296f6d5acd',
}

// ── Format tag UUIDs ──
export const FORMAT_TAGS = {
  manga: 'b0b4f3c2-0ab6-4b5c-8e96-1c8265e65c8d',       // Japanese manga (not an official MangaDex tag; use demographic)
  manhwa: 'c1e3ab98-b39e-4e7e-8acf-1fd91e5d2736',
  manhua: '052ac26b-90c1-44bd-b381-66c70d52fba2',
  oneshot: '023efa4b-a5eb-41f8-93cc-45d1c4cb9a3f',
  doujinshi: 'b13b2a48-c720-44a9-9c77-39c9979373fb',
  novel: '3bd5184f-a696-4c45-9c3f-556283daf44a',       // Light novel (not an MD tag; use format filter)
  '4-koma': 'fad79707-74df-44c9-8013-8199e4b54447',
  anthology: 'a1f33a25-5679-4ba9-9b07-2501699e496d',
}

/** Resolve a genre name or UUID to its MangaDex tag UUID. Accepts both. */
function resolveGenre(input) {
  if (!input) return null
  // If it looks like a UUID, pass through
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) return input
  return GENRE_MAP[input.toLowerCase().replace(/\s+/g, '-')] || null
}

// ── Sort order mapping ──
export const SORT_ORDERS = {
  popular: { 'order[followedCount]': 'desc' },
  rating: { 'order[rating]': 'desc' },
  latest: { 'order[latestUploadedChapter]': 'desc' },
  newest: { 'order[createdAt]': 'desc' },
  trending: { 'order[followedCount]': 'desc' },  // alias for popular
}

/**
 * Browse manga with genre, type, status, and sort filters.
 * Maps human-readable names to MangaDex API tag UUIDs + status params.
 *
 * @param {object} opts
 * @param {string[]} opts.genres     Genre names or tag UUIDs
 * @param {string}   opts.format     null | manga | manhwa | manhua | oneshot | doujinshi | novel
 * @param {string[]} opts.status     ongoing | completed | hiatus | cancelled
 * @param {string}   opts.sort       popular | rating | latest | newest | trending
 * @param {number}   opts.limit
 * @param {number}   opts.offset
 */
export async function browseManga({
  genres = [], format = null, status = [], sort = 'popular', limit = 24, offset = 0,
} = {}) {
  const key = `browse:${genres.join(',')}:${format || ''}:${status.join(',')}:${sort}:${limit}:${offset}`
  return cached(key, 5 * 60 * 1000, async () => {
    const params = {
      limit,
      offset,
      'includes[]': 'cover_art',
      'contentRating[]': ['safe', 'suggestive', 'erotica'],
    }

    // Genre → tag UUIDs
    const tagIds = genres.map(resolveGenre).filter(Boolean)
    if (tagIds.length > 0) {
      params['includedTags[]'] = tagIds
      params.includedTagsMode = 'AND'
    }

    // Format → extra tag
    if (format && FORMAT_TAGS[format]) {
      const existing = Array.isArray(params['includedTags[]'])
        ? params['includedTags[]']
        : params['includedTags[]'] ? [params['includedTags[]']] : []
      params['includedTags[]'] = [...existing, FORMAT_TAGS[format]]
      if (tagIds.length > 0) params.includedTagsMode = 'AND'
    }

    // Status
    const validStatuses = status.filter((s) =>
      ['ongoing', 'completed', 'hiatus', 'cancelled'].includes(s),
    )
    if (validStatuses.length > 0) {
      params['status[]'] = validStatuses
    }

    // Sort
    Object.assign(params, SORT_ORDERS[sort] || SORT_ORDERS.popular)

    const { data } = await api.get('/manga', { params })
    return {
      results: (data.data || []).map(normalizeManga),
      total: data.total || 0,
      offset: data.offset || 0,
      limit: data.limit || limit,
    }
  })
}

/**
 * Get aggregate chapter info — groups chapters by volume for the volume picker.
 * GET /manga/{id}/aggregate?translatedLanguage[]=en
 */
export async function getAggregate(mangaId, language = 'en') {
  const key = `aggregate:${mangaId}:${language}`
  return cached(key, 10 * 60 * 1000, async () => {
    const { data } = await api.get(`/manga/${mangaId}/aggregate`, {
      params: { 'translatedLanguage[]': language },
    })
    return data.volumes || {}
  })
}

// Re-export for provider-style usage
export const mangadexProvider = {
  name: 'mangadex',
  searchManga,
  getMangaInfo,
  getChapterFeed,
  getChapterPages,
  getLatestManga,
  getMangaByTag,
  getAggregate,
}
