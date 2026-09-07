// TMDB (themoviedb.org) — used to fetch transparent anime title logos for
// the hero + anime details page.  Logos are community-uploaded PNGs served
// from https://image.tmdb.org/t/p/{size}{file_path}.
//
// We have no AniList→TMDB direct link, so we search by the anime's English
// (or romaji) title and pick the first Japanese-origin TV result.  All
// failures return null and the caller falls back to a styled wordmark.

import type { Anime } from '../types'

// TMDB calls go through the backend relay (/api/tmdb3) which injects the
// api_key server-side — the renderer never sees or sends the key.
// (Security fix: key used to ship in VITE_TMDB_API_KEY and ride in the
// browser URL to api.themoviedb.org.)
const RELAY = '/api/tmdb3'
const IMG = 'https://image.tmdb.org/t/p'
const TTL = 24 * 60 * 60 * 1000 // 24h — titles & logos change rarely
// Negative (not-found) results must NOT outlive upstream changes: a show
// that has no TMDB logo today often gains one within days/weeks. Re-check
// misses every 30 min instead of pinning them for 24h.
const NEG_TTL = 30 * 60 * 1000
const TIMEOUT_MS = 3000

interface CacheEntry {
  at: number
  value: unknown
}
const cache = new Map<string, CacheEntry>()

async function get<T>(path: string): Promise<T | null> {
  const url = `${RELAY}${path}`
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
  const remote = `${IMG}/${size}${logo.file_path}`
  // Serve logo PNGs through the app's own /img proxy instead of hitting
  // image.tmdb.org directly: the proxy memory-caches the bytes (48h) and
  // sends long-lived `immutable` browser headers, so repeat logo renders
  // resolve from localhost in milliseconds instead of a ~1s CDN round trip.
  // (The proxy preserves content-type, so transparent PNGs stay transparent.)
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    return `/img?url=${encodeURIComponent(remote)}`
  }
  return remote
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
  if (cached && Date.now() - cached.at < (cached.value == null ? NEG_TTL : TTL)) return cached.value as number | null

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
  if (cached && Date.now() - cached.at < entryTtl(cached)) return cached.value as string | null

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

/** Effective per-entry TTL — nulls re-check sooner than real hits. */
function entryTtl(entry: CacheEntry | undefined): number {
  if (!entry) return 0
  return entry.value == null ? NEG_TTL : TTL
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
  if (cached && Date.now() - cached.at < entryTtl(cached)) return { logo: cached.value as TmdbLogo | null }

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
 * Fetch a high-quality TMDB backdrop image for an anime title.
 * Returns the absolute URL (w1280 — crisp at hero scale, ~5-10x smaller
 * than /original) or null if nothing found. Cached for 24h — safe to
 * call repeatedly in React Query.
 */
export async function getTmdbBackdrop(title: string): Promise<string | null> {
  const cacheKey = `bd2:${title}` // v2 — w1280 tier (was /original); key bump evicts stale URLs
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < entryTtl(cached)) return cached.value as string | null

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

  // w1280 — visually identical at hero scale (~1600px max, usually shown
  // 900-1600 wide) but 5-10x smaller than /original, so the first fetch
  // through /img (and every disk-cache fill) is dramatically faster.
  const url = best ? `${IMG}/w1280${best.file_path}` : null
  cache.set(cacheKey, { at: Date.now(), value: url })
  return url
}

/** Server-resolved TMDB hybrid art (exact MAL→TMDB mapping, no client search). */
export interface TmdbArt {
  /** Hero-quality 16:9 backdrop (w1280) — null when TMDB has none. */
  backdrop: string | null
  /** 2:3 grid poster (w500) — null when TMDB has none. */
  poster: string | null
}

const artCache = new Map<number, { at: number; art: TmdbArt | null }>()
const ART_TTL = 24 * 60 * 60 * 1000

/**
 * Fetch the best TMDB backdrop + poster for a MAL id.
 *
 * Server-side /api/tmdb-art/:malId resolves the EXACT TMDB id via the
 * AniZip mapping (MAL → themoviedb_id) and returns the best images in one
 * round trip — sequel-safe, no fuzzy title search, and cached 24h on the
 * server. Returns null when there's no mapping or TMDB has no art; callers
 * keep their AniList/Jikan art as the primary source and use this as a
 * high-quality fallback/upgrade.
 */
export async function fetchTmdbArt(malId: number): Promise<TmdbArt | null> {
  if (!Number.isFinite(malId) || malId < 1) return null
  const hit = artCache.get(malId)
  if (hit && Date.now() - hit.at < (hit.art == null ? NEG_TTL : ART_TTL)) return hit.art
  try {
    const ctrl = new AbortController()
    const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(`/api/tmdb-art/${malId}`, { signal: ctrl.signal })
    window.clearTimeout(t)
    if (!res.ok) return null
    const json = await res.json()
    const art: TmdbArt | null = json?.ok ? (json.art ?? null) : null
    artCache.set(malId, { at: Date.now(), art })
    return art
  } catch {
    return null
  }
}

/** True when TMDB is usable through the backend relay. */
export const hasTmdbKey = (): boolean => true

// Re-export Anime for the in-line cast below
export type { Anime }
