// AniZip — free episode metadata + thumbnails (TVDB-sourced).
// Docs: https://api.ani.zip/
//
// Important quirks:
//  - AniZip sometimes returns episodes from the FULL franchise (all seasons)
//    instead of just the queried entry. We trim those to the cap from Jikan.
//  - Placeholder rows with no title and no image leak through for unaired
//    or movie-bundle episodes — we filter them out.
//  - airDate may be in the future for not-yet-aired episodes.

import axios from 'axios'

const BASE = 'https://api.ani.zip'

const cache = new Map<string, { at: number; value: unknown }>()
const TTL = 60 * 60 * 1000 // 1 hour
const PERSIST_TTL = 24 * 60 * 60 * 1000 // 24 hours
const STORAGE_PREFIX = 'kurodo-anizip:'

function loadFromStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at: number; data: T }
    if (Date.now() - parsed.at > PERSIST_TTL) {
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
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    // Storage full — clear oldest 25% and try once more
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(STORAGE_PREFIX))
      keys.slice(0, Math.ceil(keys.length / 4)).forEach((k) => localStorage.removeItem(k))
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ at: Date.now(), data }))
    } catch { /* give up */ }
  }
}

export interface AniZipEpisode {
  episode: number
  title?: { en?: string; 'x-jat'?: string; ja?: string }
  image?: string
  airDate?: string
  airDateUtc?: string
  runtime?: number
  overview?: string
  rating?: string
  episodeNumber?: number
  seasonNumber?: number
  absoluteEpisodeNumber?: number
}

export interface AniZipMapping {
  titles?: Record<string, string>
  episodes?: Record<string, AniZipEpisode>
  episodeCount?: number
  mappings?: {
    anilist_id?: number
    mal_id?: number
    anidb_id?: number
    thetvdb_id?: number
    themoviedb_id?: string
  }
}

async function cachedGet<T>(url: string): Promise<T> {
  const hit = cache.get(url)
  if (hit && Date.now() - hit.at < TTL) return hit.value as T

  const persisted = loadFromStorage<T>(url)
  if (persisted) {
    cache.set(url, { at: Date.now(), value: persisted })
    return persisted
  }

  const { data } = await axios.get<T>(url)
  cache.set(url, { at: Date.now(), value: data })
  saveToStorage(url, data)
  return data
}

interface CleanOptions {
  /** Hard cap from Jikan (total episode count). Drops higher-numbered eps. */
  cap?: number | null
  /** Latest aired episode (from AniList's nextAiringEpisode - 1). Drops future eps when set. */
  airedThrough?: number | null
  /** Keep currently-airing episodes visible even if airDate is just past. Default true. */
  keepFutureMetadataOnly?: boolean
}

/**
 * Clean the raw episode list:
 *  - Sort by episode number
 *  - Drop placeholders with no title & no image
 *  - Drop episodes beyond Jikan's official count
 *  - Drop episodes whose airDate is in the future (when we know `airedThrough`)
 *  - Drop duplicates by episode number
 */
function cleanEpisodes(
  raw: AniZipEpisode[],
  { cap, airedThrough }: CleanOptions = {},
): AniZipEpisode[] {
  const now = Date.now()
  const seen = new Set<number>()
  return raw
    .filter((ep) => {
      // Reject negative or 0 numbers
      if (!ep.episode || ep.episode < 1) return false

      // Reject broadcast specials, recaps, and other non-canonical episodes
      if (ep.episode % 1 !== 0) return false
      const title = (ep.title?.en || ep.title?.['x-jat'] || '').toLowerCase()
      if (
        title.includes('recap') ||
        title.includes('broadcast')
      ) return false
      // Season 0 entries are usually extras; only keep them if they have
      // both a title and an image, otherwise treat them as junk.
      if (ep.seasonNumber === 0 && (!ep.title?.en || !ep.image)) return false

      // Hard cap from Jikan
      if (cap && ep.episode > cap) return false

      // Filter unaired by date when no airedThrough hint
      if (ep.airDateUtc) {
        const t = Date.parse(ep.airDateUtc)
        if (!Number.isNaN(t) && t > now + 60_000) return false
      } else if (ep.airDate) {
        const t = Date.parse(ep.airDate)
        if (!Number.isNaN(t) && t > now + 86_400_000) return false
      }

      // Filter unaired by AniList hint
      if (airedThrough != null && ep.episode > airedThrough) return false

      // Drop pure placeholder rows (no title, no image, no overview)
      const hasTitle = !!(ep.title?.en || ep.title?.['x-jat'] || ep.title?.ja)
      const hasImage = !!ep.image
      const hasOverview = !!ep.overview
      if (!hasTitle && !hasImage && !hasOverview) return false

      // Dedupe by episode number (keep first)
      if (seen.has(ep.episode)) return false
      seen.add(ep.episode)
      return true
    })
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
}

/** Episodes (with thumbnails) keyed by AniList ID. */
export async function getEpisodesByAniListId(
  anilistId: number,
  opts?: CleanOptions,
): Promise<AniZipEpisode[]> {
  try {
    const data = await cachedGet<AniZipMapping>(
      `${BASE}/mappings?anilist_id=${anilistId}`,
    )
    return cleanEpisodes(
      data.episodes ? Object.values(data.episodes) : [],
      opts,
    )
  } catch {
    return []
  }
}

/** Convenience: episodes via MAL id (does the MAL→AniList map server-side). */
export async function getEpisodesByMalId(
  malId: number,
  opts?: CleanOptions,
): Promise<AniZipEpisode[]> {
  try {
    const data = await cachedGet<AniZipMapping>(
      `${BASE}/mappings?mal_id=${malId}`,
    )
    return cleanEpisodes(
      data.episodes ? Object.values(data.episodes) : [],
      opts,
    )
  } catch {
    return []
  }
}

/** Resolve MAL id → AniList id using AniZip's mapping endpoint.
 *  Falls back to null if the mapping is unavailable. */
export async function getAniListIdFromMal(malId: number): Promise<number | null> {
  try {
    const { data } = await axios.get<AniZipMapping>(
      `${BASE}/mappings?mal_id=${malId}`,
      { timeout: 5000 },
    )
    return data.mappings?.anilist_id ?? null
  } catch {
    return null
  }
}
