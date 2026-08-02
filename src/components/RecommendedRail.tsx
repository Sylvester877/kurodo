import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useWatchListStore } from '../store/useWatchListStore'
import { getAnimeRecommendations } from '../api/anime'
import AnimeCard from './AnimeCard'
import { SkeletonRow } from './Skeleton'

/**
 * "Because you watched X" rail — uses Jikan's `/anime/{id}/recommendations`
 * endpoint with the seed = the user's most-recently-touched anime
 * (the first entry in continueWatching).
 *
 * Renders nothing when:
 *   - The user has no continueWatching entries yet (new user)
 *   - The recs endpoint returns empty
 *
 * Cached aggressively (12 h) because recommendations rarely change.
 */
export default function RecommendedRail() {
  // Anchor pick: most-recently-touched anime. We re-render when the
  // continueWatching array's HEAD changes (rather than on every internal
  // edit) by extracting only the first entry's mal_id with a selector.
  const seed = useWatchListStore((s) => s.continueWatching[0] ?? null)

  const { data, isLoading } = useQuery({
    queryKey: ['home', 'recommendations', seed?.anime.mal_id ?? null],
    queryFn: async () => {
      if (!seed) return { data: [] as { entry: { mal_id: number } }[] }
      return getAnimeRecommendations(seed.anime.mal_id)
    },
    enabled: !!seed,
    staleTime: 12 * 60 * 60 * 1000,
    meta: { persist: true },
  })

  if (!seed) return null

  // Jikan returns up to ~30 recs; the first ~12 are usually the most
  // upvoted (sorted by community vote count). Show 12.
  const recs = (data?.data ?? []).slice(0, 12).map((r) => r.entry)

  // Don't render the section when there are no recs (rather than show
  // an empty grid — confusing for the user).
  if (!isLoading && recs.length === 0) return null

  const seedTitle = seed.anime.title_english || seed.anime.title

  return (
    <section className="mt-8 mx-4">
      <div className="flex items-end justify-between mb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-5 w-5 text-amber-300" />
            <h2 className="text-xl font-bold text-white truncate">
              Because you watched{' '}
              <span className="text-primary">{seedTitle}</span>
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Community-picked next-watches
          </p>
        </div>
      </div>

      {isLoading ? (
        <SkeletonRow count={6} />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5">
          {recs.map((rec) => (
            <AnimeCard
              key={rec.mal_id}
              // Jikan rec entries are minimal; AnimeCard tolerates that
              // and shows what it has (no score, type, etc. for these
              // until the user clicks through).
              anime={rec as unknown as Parameters<typeof AnimeCard>[0]['anime']}
            />
          ))}
        </div>
      )}
    </section>
  )
}
