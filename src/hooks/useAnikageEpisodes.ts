import { useQuery } from '@tanstack/react-query'

export interface AnikageEpisode {
  number: number
  title: string | null
  titleJp: string | null
  description: string | null
  image: string | null
  airDate: string | null
  runtime: number | null
  isFiller: boolean
  isRecap: boolean
  seasonNumber: number | null
}

interface AnikageEpisodesResponse {
  episodes: AnikageEpisode[]
  total: number
  malId: number
}

/**
 * Anikage-style enriched episode data — TVDB/TMDB images + AniList titles +
 * Jikan filler flags for EVERY episode (not just the first 21 like raw AniZip).
 * 
 * The /api/anikage-episodes endpoint merges:
 *  - AniZip (TVDB images, episode titles, descriptions, runtime)
 *  - TMDB (w1280 stills for missing episodes)
 *  - Jikan (filler/recap flags)
 * 
 * Cached 1h server-side. Replaces useJikanEpisodeImages + mergeJikanEpisodeMeta.
 */
export function useAnikageEpisodes(
  malId: number | null | undefined,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['anikage-episodes', malId],
    queryFn: async (): Promise<AnikageEpisodesResponse> => {
      const origin = window.location.origin
      const res = await fetch(`${origin}/api/anikage-episodes/${malId}`, {
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) throw new Error(`Failed to load episodes: ${res.status}`)
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Unknown error')
      return json.data
    },
    enabled: !!malId && enabled,
    staleTime: 60 * 60 * 1000, // 1h — server caches for 1h too
    retry: 1,
    placeholderData: (prev) => prev, // keep old data while refreshing
  })
}
