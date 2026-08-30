import { getBackendOrigin } from '../lib/utils'

// Filler episode detection — uses animefillerlist.com data via public API
// Source: https://github.com/xsunzukz/anime-filler-episodes-api

const FILLER_CACHE = new Map<number, { at: number; data: FillerInfo }>()
const TTL = 24 * 60 * 60 * 1000 // 24 hours

export interface FillerInfo {
  malId: number
  total: number
  filler: number[]
  canon: number[]
  mixed: number[]
  animeCanon: number[]
}

async function fetchFillerFromAPI(malId: number, title: string): Promise<FillerInfo | null> {
  try {
    // Route through our backend proxy to avoid CORS issues with
    // the public filler APIs (anime-filler-api.vercel.app, kotori.workers.dev)
    // 15s: for shows NOT on AnimeFillerList, the server falls back to Jikan's
    // per-episode filler flags (paginated, deadline-capped). That path can
    // take ~5-12s on a cold cache — the old 8s window aborted before the
    // fallback ever returned, so non-AFL shows silently got zero filler data
    // until the second visit. The query is deferred 2.5s and non-critical,
    // so a 15s leash is fine.
    const res = await fetch(`${getBackendOrigin()}/api/filler/${malId}?title=${encodeURIComponent(title)}`, {
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json()

    if (data.filler_episodes || data.filler) {
      return {
        malId,
        total: data.total_episodes || data.total || 0,
        filler: data.filler_episodes || data.filler || [],
        canon: data.canon_episodes || data.canon || [],
        mixed: data.mixed_episodes || data.mixed || [],
        animeCanon: data.anime_canon_episodes || data.animeCanon || [],
      }
    }
  } catch {}
  return null
}

// Fallback: known filler lists for popular anime (offline)
const KNOWN_FILLERS: Record<number, number[]> = {
  21: [19,20,23,25,26,27,32,33,34,35,36,42,43,44,45,46,47,48,49,50,51,52,53,54,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143], // One Piece
  20: [33,50,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220], // Naruto
  1735: [57,58,59,60,61,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150], // Naruto Shippuden partial
  269: [9,12,14,16,20,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163], // Bleach
  11061: [13, 26], // Hunter × Hunter (2011) — only 2 recap episodes
  13601: [], // HxH 1999 (different style, no pure filler)
}

export async function getFillerInfo(malId: number, title: string): Promise<FillerInfo> {
  const cached = FILLER_CACHE.get(malId)
  if (cached && Date.now() - cached.at < TTL) return cached.data

  // Try API first
  const apiData = await fetchFillerFromAPI(malId, title)
  if (apiData) {
    FILLER_CACHE.set(malId, { at: Date.now(), data: apiData })
    return apiData
  }

  // Fallback to known list
  const filler = KNOWN_FILLERS[malId] || []
  const data: FillerInfo = {
    malId,
    total: 0,
    filler,
    canon: [],
    mixed: [],
    animeCanon: [],
  }
  FILLER_CACHE.set(malId, { at: Date.now(), data })
  return data
}

export function isFiller(episode: number, fillerInfo: FillerInfo | null): boolean {
  if (!fillerInfo) return false
  // AniZip episode lists return `episode` as a STRING ("351") while the
  // filler arrays hold numbers — `.includes` is strict, so raw lookups
  // silently missed every episode. Coerce before checking.
  const n = Number(episode)
  return Number.isFinite(n) && fillerInfo.filler.includes(n)
}