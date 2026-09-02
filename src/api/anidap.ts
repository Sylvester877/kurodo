// anidap.ts — frontend client for our local Node backend (which talks to anidap.se)

import axios from 'axios'
import { getBackendOrigin } from '../lib/utils'

// The single Express backend serves /api/anidap and /proxy on http://localhost:5173.
// Timeout: 45s — first browser-bridge call may need to wait for Chrome launch (~10s)
// + warm-up navigation (~5s) + API evaluation (~5s). Subsequent calls reuse the
// warm browser and complete in 5-10s.
//
// baseURL is resolved lazily so the preload-injected backend origin is
// guaranteed to be available even if this module loads before the preload
// script has populated window.electronAPI.
const api = axios.create({ timeout: 45000 })

api.interceptors.request.use((config) => {
  const origin = getBackendOrigin()
  if (origin && !config.baseURL?.startsWith('http')) {
    config.baseURL = origin
  }
  return config
})

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; upstream?: number | null }

async function call<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    const { data } = await api.get<Envelope<T>>(url, { signal })
    if (!data.ok) throw new Error(data.error)
    return data.data
  } catch (err) {
    // Don't surface cancelled requests as errors (axios throws CanceledError)
    if (axios.isCancel(err)) throw err
    // If axios swallows the JSON body (e.g. non-2xx with no body), surface it
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    const serverMsg = e.response?.data?.error
    if (serverMsg) throw new Error(serverMsg)
    throw err
  }
}

export interface AnidapInfo {
  slug: string | null
  raw: unknown
}

export interface AnidapEpisode {
  number: number
  img?: string
  titles?: Record<string, string>
  hasDub?: boolean
  hasSub?: boolean
  title?: string
}

export interface AnidapProvider {
  name: string
  type: 'sub' | 'dub' | 'hsub' | string
  /** Marked default by the upstream (highlight in UI). */
  default?: boolean
  /** Human-readable hint from chad like "Hard sub, Fastest, High quality". */
  tip?: string | null
  /** Which scraper provider owns this server ('anidap', 'miruro', etc.) */
  _provider?: string
  /** Health-check result: true if the server passed the probe. */
  _healthy?: boolean
  /** Health-check probe latency in ms (null if not probed). */
  _healthMs?: number | null
  /** Health-check error string (null unless probe failed). */
  _healthError?: string | null
  /** Health probe resolved via cross-provider fallback (different source). */
  _crossProvider?: boolean
  /** Human-readable note about the cross-provider resolution. */
  _crossProviderNote?: string | null
}

export interface AnidapChapter {
  title: string
  start: number
  end: number
}

export interface AnidapStream {
  /** Legacy URL field. Same as `raw` for chad-API streams. */
  url: string
  /** Raw upstream m3u8 (e.g. mewstream.buzz). Needs proxying for CORS. */
  raw: string
  /** Preferred URL — raw upstream through our local /proxy (carries
   *  the upstream Referer/UA in the `h=` query param). */
  proxiedUrl: string
  /** Fallback URL — currently null for chad-API streams. */
  fallbackProxiedUrl: string | null
  subtitles: Array<{ file: string; label?: string; kind?: string; default?: boolean; lang?: string }>
  /** Intro/Outro markers from chad (use for skip buttons on the timeline). */
  chapters?: AnidapChapter[] | null
  /** Upstream headers the proxy needs to echo (Referer/Origin/UA). */
  headers?: Record<string, string> | null
  /** Which scraper actually served this stream ('anidap' | 'consumet'). */
  source?: string
}

export interface AnidapInfoExt extends AnidapInfo {
  /** Which scraper resolved the slug ('anidap' | 'miruro' | 'saturn' | 'consumet'). */
  source?: string
}

export interface EpisodeListResponse {
  episodes: AnidapEpisode[]
  source: string | null
}

export interface ServerListResponse {
  providers: AnidapProvider[]
  source: string | null
  /** True when the source confirmed this anime isn't available at all. */
  unavailable?: boolean
}

/** Resolve AniList ID → slug (+ source). */
export const fetchAnidapInfo = (anilistId: number, signal?: AbortSignal) =>
  call<AnidapInfoExt>(`/api/anidap/info/${anilistId}`, signal)

/** Episode list — pass anilistId so the router can re-resolve if needed.
 *  Optional titles for hianime fallback search. */
export const fetchAnidapEpisodes = (
  slug: string,
  anilistId?: number | null,
  titles?: { english?: string | null; romaji?: string | null },
) => {
  const params = new URLSearchParams()
  if (anilistId) params.set('anilistId', String(anilistId))
  if (titles?.english) params.set('title_english', titles.english)
  if (titles?.romaji) params.set('title_romaji', titles.romaji)
  const qs = params.toString() ? `?${params}` : ''
  return call<EpisodeListResponse | { data?: AnidapEpisode[] } | AnidapEpisode[]>(
    `/api/anidap/episodes/${encodeURIComponent(slug)}${qs}`,
  ).then((res): AnidapEpisode[] => {
    if (Array.isArray(res)) return res
    if (res && 'episodes' in res && Array.isArray(res.episodes)) return res.episodes
    if (res && 'data' in res && Array.isArray(res.data)) return res.data
    return []
  })
}

/** Provider list for a specific episode.
 *  Optional titles for hianime fallback search. */
export const fetchAnidapServers = (
  slug: string,
  ep: number,
  anilistId?: number | null,
  signal?: AbortSignal,
  titles?: { english?: string | null; romaji?: string | null },
) => {
  const params = new URLSearchParams()
  if (anilistId) params.set('anilistId', String(anilistId))
  if (titles?.english) params.set('title_english', titles.english)
  if (titles?.romaji) params.set('title_romaji', titles.romaji)
  const qs = params.toString() ? `?${params}` : ''
  return call<ServerListResponse | AnidapProvider[]>(
    `/api/anidap/servers/${encodeURIComponent(slug)}/${ep}${qs}`,
    signal,
  ).then((res): { providers: AnidapProvider[]; source: string | null; unavailable?: boolean } => {
    if (Array.isArray(res)) return { providers: res, source: null }
    return { providers: res.providers ?? [], source: res.source ?? null, unavailable: res.unavailable ?? false }
  })
}

/** Decrypted stream + locally-proxied URL for HLS.js.
 *  Optional titles for hianime fallback search. */
export const fetchAnidapStream = (
  slug: string,
  ep: number,
  provider: string,
  type: string,
  opts: { anilistId?: number | null; malId?: number | null; forceSource?: string | null; signal?: AbortSignal; titles?: { english?: string | null; romaji?: string | null } } = {},
) => {
  const params = new URLSearchParams()
  if (opts.anilistId) params.set('anilistId', String(opts.anilistId))
  // The watch route param IS the MAL id — lets the megavid fast path skip
  // its server-side AniList lookup (seconds saved on cold titles).
  if (opts.malId) params.set('malId', String(opts.malId))
  if (opts.forceSource) params.set('source', opts.forceSource)
  if (opts.titles?.english) params.set('title_english', opts.titles.english)
  if (opts.titles?.romaji) params.set('title_romaji', opts.titles.romaji)
  const qs = params.toString() ? `?${params}` : ''
  return call<AnidapStream>(
    `/api/anidap/sources/${encodeURIComponent(slug)}/${ep}/${encodeURIComponent(provider)}/${type}${qs}`,
    opts.signal,
  )
}
