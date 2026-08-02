import { Link } from 'react-router-dom'
import { Play, X, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import { useWatchListStore } from '../store/useWatchListStore'
import { getImageUrl, proxifyWithFallback, cn } from '../lib/utils'
import { preloadHandlers } from '../lib/routePreloaders'
import { prefetchAnimeEpInfo } from '../lib/prefetch'
import SectionHeader from './SectionHeader'
import EmptyState from './EmptyState'
import { Tv } from 'lucide-react'

/** Format a number of seconds as "MM:SS" or "H:MM:SS". */
function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}

/**
 * Horizontal "Continue Watching" rail for the Home page.
 *
 *   • Each card shows: episode thumb (via cover image), EP N badge, title,
 *     and a thin progress bar with "5:32 left" overlay when we have a
 *     saved position from useWatchListStore.
 *   • Hover reveals a big play disc + a discreet ✕ remove button.
 *   • A "Start over" hover-action appears when there's a saved position
 *     so the user can jump back to 0:00 without resuming.
 *
 * Returns `null` when the user has nothing in continueWatching, so the
 * parent can use it conditionally without adding its own guard.
 */
export default function ContinueWatchingRail() {
  const continueWatching = useWatchListStore((s) => s.continueWatching)
  const removeFromContinue = useWatchListStore((s) => s.removeFromContinue)
  const getEpisodeProgress = useWatchListStore((s) => s.getEpisodeProgress)
  const clearEpisodeProgress = useWatchListStore((s) => s.clearEpisodeProgress)

  // Pre-warm AniList episode info for the top 2 continue-watching items.
  // This saves a 200-500ms GraphQL round-trip when the user clicks to watch.
  // Uses a stable string key to avoid re-running on every Zustand store mutation.
  const top2Key = useWatchListStore(
    (s) => s.continueWatching.slice(0, 2).map(c => c.anime.mal_id).join(',')
  )
  useEffect(() => {
    if (!top2Key) return
    for (const c of continueWatching.slice(0, 2)) {
      prefetchAnimeEpInfo(c.anime.mal_id)
    }
    // Depend on the stable string key, not the array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top2Key])

  if (continueWatching.length === 0) return (
    <section className="mt-8 mx-4">
      <SectionHeader
        title="Continue Watching"
        subtitle="Pick up where you left off"
        pill="RESUME"
        pillTone="accent"
      />
      <EmptyState
        icon={<Tv className="h-full w-full" />}
        title="Nothing to continue"
        description="Episodes you start watching will appear here so you can pick up right where you left off."
        className="py-10"
      >
        <Link
          to="/browse"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/20 text-primary border border-primary/30 font-semibold text-xs hover:bg-primary/30 transition-colors"
        >
          <Play className="h-3.5 w-3.5" /> Browse Anime
        </Link>
      </EmptyState>
    </section>
  )

  return (
    <section className="mt-8 mx-4">
      <SectionHeader
        title="Continue Watching"
        subtitle="Pick up where you left off"
        pill="RESUME"
        pillTone="accent"
      />

      <div
        className="flex gap-3 overflow-x-auto custom-scrollbar pb-3 -mx-1 px-1 contain-auto"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {continueWatching.slice(0, 12).map((c) => {
          const prog = getEpisodeProgress(c.anime.mal_id, c.episode)
          const pct = prog && prog.duration > 0
            ? Math.max(0, Math.min(1, prog.time / prog.duration))
            : 0
          const remaining = prog && prog.duration > 0
            ? Math.max(0, prog.duration - prog.time)
            : null
          const watchUrl = `/watch/${c.anime.mal_id}?ep=${c.episode}`
          return (
            <div
              key={c.anime.mal_id}
              className="relative shrink-0 w-[260px] group"
              style={{ scrollSnapAlign: 'start' }}
            >
              <Link
                to={watchUrl}
                {...preloadHandlers('/watch/x')}
                className="block rounded-2xl overflow-hidden border border-white/[0.06] bg-black/50 hover:border-white/[0.12] hover:bg-black/65 transition-all duration-200"
              >
                <div className="relative aspect-video">
                  <img
                    src={proxifyWithFallback(getImageUrl(c.anime), c.anime.title_english || c.anime.title)}
                    alt={c.anime.title}
                    className="h-full w-full object-cover bg-black/20 transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const img = e.currentTarget
                      // Fade out broken image — parent gradient shows through
                      img.style.opacity = '0'
                      img.style.transition = 'opacity 0.3s ease'
                    }}
                  />
                  {/* Bottom gradient + metadata */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                  {/* Hover play disc */}
                  <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="h-12 w-12 rounded-full bg-primary/95 grid place-items-center shadow-[0_0_30px_hsl(245,75%,60%,0.6)]">
                      <Play className="h-5 w-5 text-white fill-white ml-0.5" />
                    </div>
                  </div>

                  {/* Bottom metadata: title + EP + time-left */}
                  <div className="absolute bottom-2 left-2 right-2 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-mono font-bold text-accent">
                        EP {c.episode}
                      </p>
                      {remaining != null && remaining > 0 && (
                        <p className="glass-pill py-0.5 px-1.5 bg-black/70 border-white/10 text-[10px] font-mono text-white/85 shadow-lg">
                          {fmtTime(remaining)} left
                        </p>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-white line-clamp-1">
                      {c.anime.title_english || c.anime.title}
                    </p>
                  </div>

                  {/* Progress bar — pinned to the bottom edge, Netflix-style */}
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/60">
                    <div
                      className={cn(
                        'h-full rounded-r-full transition-all duration-500',
                        pct >= 0.92
                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                          : 'bg-primary shadow-[0_0_6px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.4)]',
                      )}
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                </div>
              </Link>

              {/* Top-right ✕ remove (hover-only). */}
              <button
                onClick={() => removeFromContinue(c.anime.mal_id)}
                aria-label="Remove from continue watching"
                title="Remove from list"
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/75 text-white/80 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              {/* Start-over button — only when there's actually saved
                  progress to discard. Anchored top-left so it never
                  overlaps with the ✕ button. */}
              {prog && pct > 0.02 && (
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    clearEpisodeProgress(c.anime.mal_id, c.episode)
                  }}
                  aria-label={`Start episode ${c.episode} over from the beginning`}
                  title="Start episode over"
                  className="absolute top-2 left-2 glass-pill py-0.5 px-2 bg-black/70 border-white/10 text-white/85 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10 hover:border-white/20 shadow-lg"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restart
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
