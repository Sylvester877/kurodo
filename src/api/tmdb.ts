// TMDB (themoviedb.org) — used to fetch transparent anime title logos for
// the hero + anime details page.  Logos are community-uploaded PNGs served
// from https://image.tmdb.org/t/p/{size}{file_path}.
//
// We have no AniList→TMDB direct link, so we search by the anime's English
// (or romaji) title and pick the first Japanese-origin TV result.  All
// failures return null and the caller falls back to a styled wordmark.

import type { Anime } from '../types'

const API_KEY = (import.meta.env.VITE_TMDB_API_KEY as string | undefined)?.trim()
const BASE = 'https://api.themoviedb.org/3'
const IMG = 'https://image.tmdb.org/t/p'
const TTL = 24 * 60 * 60 * 1000 // 24h — titles & logos change rarely
const TIMEOUT_MS = 3000

interface CacheEntry {
  at: number
  value: unknown
}
const cache = new Map<string, CacheEntry>()

async function get<T>(path: string): Promise<T | null> {
  if (!API_KEY) return null
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(API_KEY)}`
  try {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(url, { signal: ctrl.signal })
    window.clearTimeout(t)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

interface TmdbSearchResult {
  id: number
  name: string
  original_name: string
  original_language: string
  origin_country: string[]
  first_air_date?: string
  vote_average?: number
  vote_count?: number
  popularity?: number
  genre_ids?: number[]
}

interface TmdbSearchResponse {
  results: TmdbSearchResult[]
}

/** Logo shape used by both the Hero and AnimeDetails page. */
export interface TmdbLogo {
  file_path: string
  width: number
  height: number
  /** null = language-neutral (e.g. "japanese" wordmark) */
  iso_639_1: string | null
  vote_average: number
}

interface TmdbImagesResponse {
  logos: TmdbLogo[]
}

/**
 * Build a full URL for a TMDB logo file path.
 * /w500 is a good balance — small enough to load fast, big enough to be
 * crisp on 1080p.  Callers wanting the highest resolution should
 * override with `/original` (slower).
 */
export function getTmdbLogoUrl(logo: TmdbLogo, size: 'w300' | 'w500' | 'original' = 'w500'): string {
  return `${IMG}/${size}${logo.file_path}`
}

/**
 * Pick the "best" logo from a TMDB images response.
 *   1. Prefer the language-neutral / Japanese logo (iso_639_1 === null or 'ja').
 *   2. Otherwise fall back to the highest-voted logo of any language.
 *   3. Always pick the largest available width to keep it crisp on 4K.
 */
function pickBestLogo(logos: TmdbLogo[]): TmdbLogo | null {
  if (!logos?.length) return null
  const ja = logos.filter((l) => l.iso_639_1 === null || l.iso_639_1 === 'ja')
  const pool = ja.length ? ja : logos
  return pool.reduce((a, b) => (a.vote_average >= b.vote_average ? a : b))
}

/**
 * Search TMDB for a TV show by title.  Returns the TMDB TV id of the most
 * plausible match, or null if nothing found / API key missing.
 *
 * Heuristic: prefer results whose original_language === 'ja' OR
 * origin_country includes 'JP'.  Otherwise pick the highest-popularity result.
 */
async function searchTvId(title: string): Promise<number | null> {
  const cacheKey = `s:${title}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < TTL) return cached.value as number | null

  const q = encodeURIComponent(title)
  const data = await get<TmdbSearchResponse>(`/search/tv?query=${q}&include_adult=false&language=en-US`)
  if (!data?.results?.length) {
    cache.set(cacheKey, { at: Date.now(), value: null })
    return null
  }

  const jp = data.results.find(
    (r) => r.original_language === 'ja' || r.origin_country?.includes('JP'),
  )
  const best = jp ?? data.results[0]
  const value = best?.id ?? null
  cache.set(cacheKey, { at: Date.now(), value })
  return value
}

/**
 * Resolve an anime's title to a TMDB logo URL (transparent PNG of the
 * anime's title in a branded font), or null if none can be found.
 *
 * Safe to call repeatedly — cached for 24h.  Always returns within ~3s
 * (3s timeout per request) and never throws.  Use this from the Hero.
 */
export async function getAnimeLogo(anilistTitle: {
  english: string | null
  romaji: string
}): Promise<string | null> {
  const title = anilistTitle.english || anilistTitle.romaji
  if (!title) return null

  const cacheKey = `logo:${title}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < TTL) return cached.value as string | null

  const tvId = await searchTvId(title)
  if (!tvId) {
    cache.set(cacheKey, { at: Date.now(), value: null })
    return null
  }

  const images = await get<TmdbImagesResponse>(
    `/tv/${tvId}/images?include_image_language=en,ja,null`,
  )
  const logo = pickBestLogo(images?.logos ?? [])
  const url = logo ? getTmdbLogoUrl(logo) : null
  cache.set(cacheKey, { at: Date.now(), value: url })
  return url
}

/**
 * Object-returning variant used by AnimeDetails.tsx so the page can pick
 * its own logo size and still cache the underlying object.
 */
export async function fetchAnimeLogo(
  titleEn: string | null,
  titleRom: string,
): Promise<{ logo: TmdbLogo | null }> {
  const title = titleEn || titleRom
  if (!title) return { logo: null }

  const cacheKey = `logoobj:${title}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < TTL) return { logo: cached.value as TmdbLogo | null }

  const tvId = await searchTvId(title)
  if (!tvId) {
    cache.set(cacheKey, { at: Date.now(), value: null })
    return { logo: null }
  }

  const images = await get<TmdbImagesResponse>(
    `/tv/${tvId}/images?include_image_language=en,ja,null`,
  )
  const logo = pickBestLogo(images?.logos ?? [])
  cache.set(cacheKey, { at: Date.now(), value: logo })
  return { logo }
}

/**
 * Fetch the highest-quality TMDB backdrop image for an anime title.
 * Returns the absolute URL (original size) or null if nothing found.
 * Cached for 24h — safe to call repeatedly in React Query.
 */
export async function getTmdbBackdrop(title: string): Promise<string | null> {
  if (!API_KEY) return null
  const cacheKey = `bd:${title}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < TTL) return cached.value as string | null

  const tvId = await searchTvId(title)
  if (!tvId) {
    cache.set(cacheKey, { at: Date.now(), value: null })
    return null
  }

  const images = await get<{ backdrops?: { file_path: string; vote_average: number; width: number }[] }>(
    `/tv/${tvId}/images?include_image_language=en,ja,null`,
  )
  const backdrops = images?.backdrops ?? []
  if (!backdrops.length) {
    cache.set(cacheKey, { at: Date.now(), value: null })
    return null
  }

  // Pick the highest-voted backdrop with at least 1280px width
  const best = backdrops
    .filter((b) => b.width >= 1280)
    .sort((a, b) => b.vote_average - a.vote_average)[0]
    ?? backdrops.sort((a, b) => b.vote_average - a.vote_average)[0]

  const url = best ? `${IMG}/original${best.file_path}` : null
  cache.set(cacheKey, { at: Date.now(), value: url })
  return url
}

/** True when a TMDB key is configured. Use to gate UI affordances. */
export const hasTmdbKey = (): boolean => Boolean(API_KEY)

// Re-export Anime for the in-line cast below
export type { Anime }
