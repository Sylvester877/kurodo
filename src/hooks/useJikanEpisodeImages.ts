import { useQuery } from '@tanstack/react-query'
import { getJikanEpisodeMeta } from '../api/anizip'

/**
 * Best-effort fetch of real per-episode MAL screenshots (via the Jikan
 * proxy) for the anime's episode list. Runs as a separate query AFTER the
 * AniZip list has loaded so it never delays first paint. When Jikan is
 * down it fast-fails and the episode list keeps its AniZip/cover tiles.
 *
 * Merge the result into the episode list with `mergeJikanEpisodeMeta`.
 */
export function useJikanEpisodeImages(
  malId: number | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['jikan-episode-images', malId],
    queryFn: () => getJikanEpisodeMeta(malId as number),
    enabled: !!malId && enabled,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  })
}
