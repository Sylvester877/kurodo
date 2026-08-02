import { Link } from 'react-router-dom'
import { Play, X, BookOpen } from 'lucide-react'
import { useMangaListStore } from '../store/useMangaListStore'
import { cn } from '../lib/utils'
import SectionHeader from './SectionHeader'
import EmptyState from './EmptyState'

/**
 * Horizontal "Continue Reading" rail for the Manga browse page.
 *
 *   • Each card shows: cover image, chapter badge, title,
 *     and a thin progress bar with page progress.
 *   • Hover reveals a play disc + a discreet ✕ remove button.
 *   • Max 6 cards displayed in a horizontal scrollable rail.
 *
 * Returns `null` when there's no data in continueReading, showing an
 * empty state prompting the user to browse manga.
 */
export default function MangaContinueReadingRail() {
  const rawEntries = useMangaListStore((s) => s.continueReading)
  const continueReading = [...rawEntries].sort((a, b) => b.timestamp - a.timestamp)
  const removeFromContinue = useMangaListStore((s) => s.removeFromContinueReading)

  if (continueReading.length === 0) return (
    <section className="mt-8">
      <SectionHeader
        title="Continue Reading"
        subtitle="Pick up where you left off"
        pill="RESUME"
        pillTone="accent"
      />
      <EmptyState
        icon={<BookOpen className="h-full w-full" />}
        title="Nothing to continue"
        description="Manga chapters you start reading will appear here so you can pick up right where you left off."
        className="py-10"
      >
        <Link
          to="/manga"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/20 text-primary border border-primary/30 font-semibold text-xs hover:bg-primary/30 transition-colors"
        >
          <Play className="h-3.5 w-3.5" /> Browse Manga
        </Link>
      </EmptyState>
    </section>
  )

  const displayEntries = continueReading.slice(0, 6)

  return (
    <section className="mt-8">
      <SectionHeader
        title="Continue Reading"
        subtitle="Pick up where you left off"
        pill="RESUME"
        pillTone="accent"
      />

      <div
        className="flex gap-3 overflow-x-auto custom-scrollbar pb-3 -mx-1 px-1 contain-auto"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {displayEntries.map((entry) => {
          const progressPct = entry.totalPages > 0
            ? Math.max(0, Math.min(1, entry.page / entry.totalPages))
            : 0

          const mangaId = entry.atsuId || entry.mangaDexId || ''
          const source = entry.source
          const readUrl = `/manga/read/${entry.chapterId}?manga=${mangaId}&source=${source}${entry.mal_id ? `&malId=${entry.mal_id}` : ''}#rs=p:${entry.page}`

          return (
            <div
              key={`${entry.mal_id}-${entry.chapterId}`}
              className="relative shrink-0 w-[200px] group"
              style={{ scrollSnapAlign: 'start' }}
            >
              <Link
                to={readUrl}
                className="block rounded-2xl overflow-hidden border border-white/[0.06] bg-black/50 hover:border-white/[0.12] hover:bg-black/65 transition-all duration-200"
              >
                <div className="relative aspect-[3/4]">
                  {entry.coverUrl ? (
                    <img
                      src={entry.coverUrl}
                      alt={entry.title}
                      className="h-full w-full object-cover bg-black/20 transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      decoding="async"
                      onError={(e) => {
                        const img = e.currentTarget
                        img.style.opacity = '0'
                        img.style.transition = 'opacity 0.3s ease'
                      }}
                    />
                  ) : (
                    <div className="h-full w-full grid place-items-center bg-white/[0.03]">
                      <BookOpen className="h-8 w-8 text-white/10" />
                    </div>
                  )}

                  {/* Gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                  {/* Hover play disc */}
                  <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="h-11 w-11 rounded-full bg-primary/95 grid place-items-center shadow-[0_0_25px_hsl(245,75%,60%,0.6)]">
                      <Play className="h-5 w-5 text-white fill-white ml-0.5" />
                    </div>
                  </div>

                  {/* Bottom metadata */}
                  <div className="absolute bottom-2 left-2 right-2 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-mono font-bold text-accent">
                        Ch. {entry.chapter}
                      </p>
                      {entry.totalPages > 0 && (
                        <span className="glass-pill text-[10px] font-mono text-white/80 bg-black/60 border-black/40 py-0.5 px-1.5">
                          {entry.page}/{entry.totalPages}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-white line-clamp-1 leading-tight">
                      {entry.title}
                    </p>
                    {entry.chapterTitle && (
                      <p className="text-[10px] text-white/45 line-clamp-1">{entry.chapterTitle}</p>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/60">
                    <div
                      className={cn(
                        'h-full rounded-r-full transition-all duration-500',
                        progressPct >= 0.9
                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                          : 'bg-primary shadow-[0_0_6px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.4)]',
                      )}
                      style={{ width: `${progressPct * 100}%` }}
                    />
                  </div>
                </div>
              </Link>

              {/* Top-right ✕ remove (hover-only) */}
              <button
                onClick={() => removeFromContinue(entry.mal_id)}
                aria-label="Remove from continue reading"
                title="Remove from list"
                className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/75 text-white/80 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              {/* Source badge (top-left) */}
              <span className="absolute top-2 left-2 glass-pill text-[9px] font-semibold bg-black/65 text-white/50 border-black/40 opacity-0 group-hover:opacity-100 transition-opacity py-0.5 px-1.5">
                {entry.source === 'atsu' ? 'atsu.moe' : 'MangaDex'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
