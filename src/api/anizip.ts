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
import { getBackendOrigin } from '../lib/utils'

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
  /** MAL filler flag (from Jikan episode metadata) — true for filler episodes. */
  filler?: boolean
  /** MAL recap flag (from Jikan episode metadata) — true for recap episodes. */
  recap?: boolean
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

// ── Jikan (MAL) episode metadata — real per-episode screencaps ─────────
// AniZip's TVDB-sourced images only cover a few episodes for long shows
// (e.g. Bleach has 380 eps but images for just 1–21). Jikan's
// /anime/{id}/episodes endpoint carries MAL's per-episode screenshots,
// which cover far more episodes. We fetch it best-effort (non-blocking,
// fast-fail when Jikan is down) and merge real images in where AniZip has
// none. The request goes through our /api/jikan proxy so it inherits the
// rate-limit pacing + AniList fallback + fail-cache behaviour.
export interface JikanEpisodeMeta {
  image?: string
  filler?: boolean
  recap?: boolean
}

const jikanEpCache = new Map<number, { at: number; data: Map<number, JikanEpisodeMeta> }>()
const JIKAN_EP_TTL = 60 * 60 * 1000 // 1h — MAL episode images are static

/** Fetch per-episode MAL metadata (images + filler/recap flags) via our
 *  Jikan proxy. Paginated at 100/page, capped at 4 pages (400 eps).
 *  Never throws — returns whatever it managed to collect. */
export async function getJikanEpisodeMeta(
  malId: number,
): Promise<Map<number, JikanEpisodeMeta>> {
  const cached = jikanEpCache.get(malId)
  if (cached && Date.now() - cached.at < JIKAN_EP_TTL) return cached.data

  const out = new Map<number, JikanEpisodeMeta>()
  try {
    for (let page = 1; page <= 4; page++) {
      const res = await fetch(
        `${getBackendOrigin()}/api/jikan/anime/${malId}/episodes?page=${page}`,
        { signal: AbortSignal.timeout(4000) },
      )
      if (!res.ok) break
      const json = await res.json().catch(() => null)
      const list = json?.data
      if (!Array.isArray(list) || list.length === 0) break
      for (const e of list) {
        // Jikan puts the episode NUMBER in `mal_id`; `episode` is often null.
        const num = Number(e.episode ?? e.mal_id)
        if (!num || !Number.isFinite(num)) continue
        out.set(num, {
          image: e.images?.jpg?.image_url || e.images?.webp?.image_url || undefined,
          filler: !!e.filler,
          recap: !!e.recap,
        })
      }
      if (!json?.pagination?.has_next_page) break
    }
  } catch {
    // Jikan down/blocked — keep whatever pages succeeded (may be none)
  }

  // ── TMDB: COMPLETE real per-episode screencaps (server-side key). ──
  // The server resolves MAL → TMDB via AniZip and returns a still URL for
  // every episode in one request (Bleach: 366/366). Only fills episodes
  // that still lack an image so AniZip's TVDB screencaps stay preferred.
  try {
    const res = await fetch(
      `${getBackendOrigin()}/api/episode-thumbs/${malId}`,
      { signal: AbortSignal.timeout(8000) },
    )
    if (res.ok) {
      const json = await res.json().catch(() => null)
      const eps = json?.data?.eps
      if (eps && typeof eps === 'object') {
        for (const [num, url] of Object.entries(eps)) {
          const n = Number(num)
          if (!n || !Number.isFinite(n) || typeof url !== 'string') continue
          const existing = out.get(n)
          if (!existing?.image) out.set(n, { ...(existing || {}), image: url })
        }
      }
    }
  } catch {
    // TMDB down — keep Jikan/AniZip data only
  }

  if (out.size > 0) jikanEpCache.set(malId, { at: Date.now(), data: out })
  return out
}

/** Merge Jikan's real episode screenshots into an AniZip episode list.
 *  AniZip images win where both exist (TVDB screencaps are higher quality);
 *  Jikan fills the gaps. Returns the same array reference when nothing
 *  changed so useMemo/useEffect deps don't churn. */
export function mergeJikanEpisodeMeta(
  episodes: AniZipEpisode[],
  meta: Map<number, JikanEpisodeMeta> | undefined,
): AniZipEpisode[] {
  if (!meta || meta.size === 0 || episodes.length === 0) return episodes
  let changed = false
  const merged = episodes.map((ep) => {
    const j = meta.get(ep.episode)
    if (!j) return ep
    // Apply Jikan's filler/recap flags REGARDLESS of whether the episode
    // already has an image — Jikan's episodes endpoint never returns
    // images (only flags), so skipping this for eps with an AniZip/TMDB
    // image used to silently drop the filler badge for those episodes.
    // The existing image still wins for display; Jikan only fills gaps.
    const newImage = ep.image || j.image
    if (newImage === ep.image && ep.filler === j.filler && ep.recap === j.recap) return ep
    changed = true
    return {
      ...ep,
      image: newImage,
      filler: j.filler,
      recap: j.recap,
    } as AniZipEpisode
  })
  return changed ? merged : episodes
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
