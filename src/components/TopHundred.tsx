import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Star } from 'lucide-react'
import { getAllTimeTop, getTrending, getPopularAiring } from '../api/anilist'
import { cn, proxifyImgUrl } from '../lib/utils'
import SectionHeader from './SectionHeader'

// ── anikototv.tv pattern (researched Sep 2026): "Top anime" with Day / Week /
// Month tabs. Kurodo mapping — every tab reuses a query another Home surface
// already warms, so switching tabs costs ZERO extra network requests warm:
//   • Day   → TRENDING_DESC (Hero + TrendingRail share this key)
//   • Week  → currently-airing by SCORE (getPopularAiring shares 'thisSeason')
//   • Month → all-time SCORE_DESC (Hero "Most Favorite" + feed row share this)
type Range = 'day' | 'week' | 'month'

const RANGES: { key: Range; label: string; pill: string }[] = [
  { key: 'day', label: 'Day', pill: 'TRENDING' },
  { key: 'week', label: 'Week', pill: 'AIRING' },
  { key: 'month', label: 'Month', pill: 'ALL TIME' },
]

export default function TopHundred() {
  const [range, setRange] = useState<Range>('month')

  const { data, isLoading } = useQuery({
    queryKey: ['home', 'top-ten', range],
    // perPage 18 keeps the shared-request dedupe with the Hero backdrops.
    queryFn: () => {
      if (range === 'day') return getTrending(18)
      if (range === 'week') return getPopularAiring(18)
      return getAllTimeTop(18)
    },
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })

  const items = (data ?? []).slice(0, 10)

  if (isLoading && items.length === 0) {
    return (
      <section className="mt-8 mx-4">
        <div className="h-8 w-48 bg-card rounded shimmer mb-5" />
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl shimmer" />
          ))}
        </div>
      </section>
    )
  }

  if (items.length === 0) return null

  return (
    <section className="mt-8 mx-4">
      <SectionHeader
        title="Top 10 Anime"
        pill={RANGES.find((r) => r.key === range)?.pill ?? 'ALL TIME'}
        pillTone="top"
        to="/browse?filter=top-rated"
      />

      {/* ── Range tabs — anikototv "Day Week Month" pill row ── */}
      <div className="flex items-center gap-1.5 -mt-2 mb-3" role="tablist" aria-label="Top anime time range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            role="tab"
            aria-selected={range === r.key}
            onClick={() => setRange(r.key)}
            className={cn(
              'px-3.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all border',
              range === r.key
                ? 'bg-primary text-white border-primary/50 shadow-[0_0_14px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.35)]'
                : 'bg-white/[0.04] text-white/60 border-white/10 hover:bg-white/10 hover:text-white',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Ranked list — anikage-style two-column big numbers ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={range}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          className="grid sm:grid-cols-2 gap-x-4 gap-y-2"
        >
          {items.map((m, idx) => {
            const title = m.title.english || m.title.romaji
            const cover = m.coverImage.large || ''
            const rank = idx + 1
            const score = m.averageScore ? (m.averageScore / 10).toFixed(1) : null
            const genres = m.genres?.slice(0, 2) || []

            return (
              <motion.div
                key={`${range}-${m.id}`}
                initial={{ opacity: 0, x: -12 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.35, delay: Math.min(idx * 0.04, 0.2), ease: 'easeOut' }}
              >
                <Link
                  to={m.idMal ? `/anime/${m.idMal}` : '#'}
                  className="group flex items-center gap-3 sm:gap-4 p-3 rounded-xl bg-white/[0.015] hover:bg-white/[0.05] border border-white/[0.03] hover:border-primary/20 transition-all duration-300"
                >
                  {/* ── Rank number ── */}
                  <div
                    className={cn(
                      'shrink-0 w-8 sm:w-10 text-center text-2xl sm:text-3xl font-black tabular-nums',
                      rank <= 3
                        ? 'text-primary drop-shadow-[0_0_12px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.5)]'
                        : 'text-white/12',
                    )}
                  >
                    {rank.toString().padStart(2, '0')}
                  </div>

                  {/* ── Poster thumbnail ── */}
                  <div className="shrink-0 h-[68px] w-[48px] sm:h-[80px] sm:w-[56px] rounded-lg overflow-hidden bg-card border border-white/[0.06]">
                    {cover && (
                      <img
                        src={proxifyImgUrl(cover)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover transition-transform duration-400 group-hover:scale-105"
                      />
                    )}
                  </div>

                  {/* ── Info ── */}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-white group-hover:text-primary transition-colors truncate">
                      {title}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {genres.map((g) => (
                        <span
                          key={g}
                          className="glass-pill text-[9px] py-0.5 px-1.5"
                        >
                          {g}
                        </span>
                      ))}
                      {m.episodes && (
                        <span className="text-[10px] text-white/35 ml-auto">
                          {m.episodes} EP
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Score ── */}
                  {score && (
                    <div className="shrink-0 glass-pill text-amber-400 border-amber-500/25 bg-amber-500/10 group-hover:bg-amber-500/15 group-hover:border-amber-500/25 transition-all duration-200">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      <span className="text-sm font-bold tabular-nums">{score}</span>
                    </div>
                  )}
                </Link>
              </motion.div>
            )
          })}
        </motion.div>
      </AnimatePresence>
    </section>
  )
}
