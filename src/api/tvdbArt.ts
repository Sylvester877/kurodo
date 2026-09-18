// TVDB key-art client — clearlogo / background / banner per anime.
//
// Pipeline (anikage.cc parity): the SERVER resolves direct
// artworks.thetvdb.com URLs (CORS *, CDN-cacheable) via the shared AniZip
// mapping; the renderer caches the RESOLUTION with react-query (24h stale,
// persisted) and serves the images through the /img proxy (48h memory +
// immutable browser headers) so repeat renders are localhost-fast.
//
// Fallback chain at the call site: TVDB art → TMDB logo (existing
// ['tmdbLogo', title] cache) → wordmark.
import { useQuery } from '@tanstack/react-query'

export interface TvdbArt {
  tvdbId: number | null
  clearlogo: string | null
  background: string | null
  banner: string | null
  poster: string | null
}

const EMPTY: TvdbArt = { tvdbId: null, clearlogo: null, background: null, banner: null, poster: null }

/** Route the artwork through the app's /img proxy (memory-cached, immutable). */
export function proxifyTvdbArt(url: string | null | undefined): string | null {
  if (!url) return null
  if (typeof window === 'undefined') return url
  if (!/^https?:$/.test(window.location.protocol)) return url
  return `/img?url=${encodeURIComponent(url)}`
}

/**
 * Resolve TVDB key art. Enabled only when an id is provided.
 * Stale 24h + persisted — a restart paints the hero without a round-trip.
 */
export function useTvdbArt(opts: { malId?: number | null; anilistId?: number | null; enabled?: boolean }) {
  const malId = opts.malId ?? null
  const anilistId = opts.anilistId ?? null
  const enabled = (opts.enabled ?? true) && !!(malId || anilistId)
  return useQuery<TvdbArt>({
    queryKey: ['tvdbArt', malId, anilistId],
    queryFn: async () => {
      const p = new URLSearchParams()
      if (malId) p.set('mal_id', String(malId))
      if (anilistId) p.set('anilist_id', String(anilistId))
      const ctrl = new AbortController()
      const t = window.setTimeout(() => ctrl.abort(), 5000)
      try {
        const res = await fetch(`/api/tvdb-art?${p.toString()}`, { signal: ctrl.signal })
        if (!res.ok) return EMPTY
        const json = await res.json()
        if (!json?.ok) return EMPTY
        return {
          tvdbId: json.tvdbId ?? null,
          clearlogo: json.clearlogo ?? null,
          background: json.background ?? null,
          banner: json.banner ?? null,
          poster: json.poster ?? null,
        }
      } catch {
        return EMPTY
      } finally {
        window.clearTimeout(t)
      }
    },
    enabled,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: false,
    meta: { persist: true },
  })
}
