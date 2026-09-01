import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar, Star, Play, ChevronLeft, ChevronRight,
  Sparkles, Film,
} from 'lucide-react'
import { getSeasonal, type FeedMedia } from '../api/anilist'
import { useTitle } from '../hooks/useTitle'
import { cn, proxifyImgUrl, formatScore } from '../lib/utils'
import StaggerCard from '../components/StaggerCard'

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
type Season = (typeof SEASONS)[number]

const SEASON_META: Record<Season, { label: string; icon: React.ReactNode; bg: string; emoji: string }> = {
  WINTER: { label: 'Winter', icon: <Snowflake />, bg: 'from-blue-900/30 to-slate-900/30', emoji: '❄️' },
  SPRING: { label: 'Spring', icon: <Blossom />, bg: 'from-pink-900/30 to-rose-900/30', emoji: '🌸' },
  SUMMER: { label: 'Summer', icon: <Sun />, bg: 'from-amber-900/30 to-orange-900/30', emoji: '☀️' },
  FALL:   { label: 'Fall', icon: <Leaf />, bg: 'from-orange-900/30 to-red-900/30', emoji: '🍂' },
}

function Snowflake() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20m-8-8 8 8m8-8-8 8M2 12l8-8m4 0 8 8"/><circle cx="12" cy="12" r="1"/></svg> }
function Blossom()   { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4M4.9 4.9l2.8 2.8m8.5 8.5 2.8 2.8M4.9 19.1l2.8-2.8m8.5-8.5 2.8-2.8"/></svg> }
function Sun()        { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg> }
function Leaf()       { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.8 10-10 10Z"/><path d="M2 21c0-3 1.9-5.4 4.7-6.5"/></svg> }

function pickPoster(m: FeedMedia): string {
  return m.coverImage.extraLarge || m.coverImage.large || ''
}

const NOW = new Date()
const CURRENT_YEAR = NOW.getFullYear()
const CURRENT_SEASON: Season = (() => {
  const m = NOW.getMonth()
  if (m < 3) return 'WINTER'
  if (m < 6) return 'SPRING'
  if (m < 9) return 'SUMMER'
  return 'FALL'
})()

const YEAR_RANGE = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1]

export default function Seasonal() {
  useTitle('Seasonal Calendar')
  const [season, setSeason] = useState<Season>(CURRENT_SEASON)
  const [year, setYear] = useState(CURRENT_YEAR)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['seasonal', season, year],
    queryFn: () => getSeasonal(season, year, 30),
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })

  const meta = SEASON_META[season]
  const scoreCutoff = useMemo(() => {
    if (items.length === 0) return 0
    const scores = items.map(m => m.averageScore ?? 0).filter(Boolean).sort((a, b) => b - a)
    return scores[Math.min(9, scores.length - 1)] ?? 0
  }, [items])

  return (
    <div className="pt-20 pb-12 min-h-screen">
      <div className="max-w-[1600px] mx-auto px-4">
        {/* ───── Header ───── */}
        <div className="glass-card rounded-2xl p-5 mb-5 relative overflow-hidden">
          <div className={`absolute inset-0 bg-gradient-to-br ${meta.bg} pointer-events-none`} />
          <div className="relative flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-white/[0.06] border border-white/10 grid place-items-center">
              <span className="text-2xl">{meta.emoji}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">
                Seasonal Calendar
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Browse anime by season · powered by AniList
              </p>
            </div>
          </div>
        </div>

        {/* ───── Season + Year picker ───── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          {/* Season tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/8">
            {SEASONS.map((s) => {
              const sm = SEASON_META[s]
              const active = s === season
              return (
                <button
                  key={s}
                  onClick={() => setSeason(s)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
                    active
                      ? 'bg-primary text-white shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.5)]'
                      : 'text-white/55 hover:text-white hover:bg-white/5',
                  )}
                >
                  <span className="text-sm">{sm.emoji}</span>
                  {sm.label}
                </button>
              )
            })}
          </div>

          {/* Year stepper */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setYear((y) => Math.max(YEAR_RANGE[0], y - 1))}
              disabled={year <= YEAR_RANGE[0]}
              className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-base font-bold text-white tabular-nums min-w-[60px] text-center">
              {year}
            </span>
            <button
              onClick={() => setYear((y) => Math.min(YEAR_RANGE[2], y + 1))}
              disabled={year >= YEAR_RANGE[2]}
              className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ───── Loading state ───── */}
        {isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5 contain-auto">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl overflow-hidden">
                <div className="aspect-[3/4] shimmer" />
                <div className="p-3 space-y-2">
                  <div className="h-3 w-3/4 rounded shimmer" />
                  <div className="h-2 w-1/2 rounded shimmer" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ───── Results grid ───── */}
        {!isLoading && items.length === 0 && (
          <div className="glass-card rounded-2xl py-16 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-white/80 font-semibold mb-1">No anime listed yet</p>
            <p className="text-xs text-muted-foreground">
              AniList may not have entries for {meta.label} {year} yet — try a past season.
            </p>
          </div>
        )}

        {!isLoading && items.length > 0 && (
          <>
            {/* Stats ribbon */}
            <div className="flex items-center gap-4 mb-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5">
                <Film className="h-3.5 w-3.5" />
                {items.length} titles
              </span>
              <span className="flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 text-amber-400" />
                Top avg: {formatScore(items[0]?.averageScore ?? null)}
              </span>
              {items.filter(m => m.status === 'RELEASING').length > 0 && (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {items.filter(m => m.status === 'RELEASING').length} airing
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5 contain-auto">
              {items.map((m, i) => {
                const title = m.title.english || m.title.romaji
                const color = m.coverImage.color || 'hsl(245 75% 60%)'
                const isTop10 = m.averageScore && m.averageScore >= scoreCutoff
                const poster = pickPoster(m)

                return (
                  <StaggerCard key={m.id} index={i}>
                  <Link
                    to={m.idMal ? `/anime/${m.idMal}` : '#'}
                    className="group block card-tilt rounded-xl"
                  >
                    <div className="glass-card rounded-xl overflow-hidden hover:border-primary/30 transition-colors">
                      <div className="relative aspect-[3/4] overflow-hidden bg-black/20">
                        {poster ? (
                          <img
                            src={proxifyImgUrl(poster)}
                            alt={title}
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover transition-transform duration-400 group-hover:scale-105"
                          />
                        ) : (
                          <div className="h-full w-full bg-card grid place-items-center">
                            <Film className="h-10 w-10 text-white/10" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />

                        {/* Rank badge — top left */}
                        {i < 10 && (
                          <div
                            className="absolute top-2 left-2 h-6 w-6 rounded-md grid place-items-center text-[10px] font-bold text-white shadow-lg"
                            style={{ backgroundColor: `${color}cc` }}
                          >
                            {i + 1}
                          </div>
                        )}

                        {/* Status pill */}
                        {m.status === 'RELEASING' && (
                          <div className="absolute top-2 right-2 glass-pill bg-emerald-500/90 text-white border-emerald-500/30 text-[9px]">
                            <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
                            Airing
                          </div>
                        )}
                        {m.status === 'NOT_YET_RELEASED' && (
                          <div className="absolute top-2 right-2 glass-pill bg-amber-500/90 text-white border-amber-500/30 text-[9px]">
                            Upcoming
                          </div>
                        )}

                        {/* Play hover affordance */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <div className="h-12 w-12 rounded-full bg-primary/95 grid place-items-center shadow-[0_0_30px_hsl(245,75%,60%,0.5)]">
                            <Play className="h-5 w-5 text-white fill-white ml-0.5" />
                          </div>
                        </div>

                        {/* Bottom info */}
                        <div className="absolute bottom-0 left-0 right-0 p-3">
                          <h3 className="font-semibold text-xs text-white line-clamp-2 leading-snug">
                            {title}
                          </h3>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {m.averageScore && (
                              <span className="flex items-center gap-0.5 text-[10px] text-amber-300 font-semibold">
                                <Star className="h-2.5 w-2.5 fill-amber-300" />
                                {formatScore(m.averageScore)}
                              </span>
                            )}
                            {m.format && (
                              <span className="text-[10px] text-white/65">
                                {m.format === 'TV' ? 'TV' : m.format}
                              </span>
                            )}
                            {m.episodes && (
                              <span className="text-[10px] text-white/65">
                                {m.episodes} ep
                              </span>
                            )}
                            {isTop10 && i >= 10 && (
                              <span className="ml-auto text-[9px] font-bold text-accent flex items-center gap-0.5">
                                <Sparkles className="h-2 w-2" />
                                Top
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Color accent line at bottom — per-anime palette */}
                        <div
                          className="absolute bottom-0 left-0 right-0 h-0.5"
                          style={{ backgroundColor: color, opacity: 0.6 }}
                        />
                      </div>
                    </div>
                  </Link>
                  </StaggerCard>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
