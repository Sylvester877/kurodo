import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar, Clock, Star, Radio, Bell, CalendarDays,
  ChevronRight, Tv, Filter, X,
} from 'lucide-react'
import { getAiringSchedule, type AiringSchedule } from '../api/anilist'
import { useTitle } from '../hooks/useTitle'
import { cn } from '../lib/utils'
import StaggerCard from '../components/StaggerCard'
import { useWatchListStore } from '../store/useWatchListStore'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface DayInfo { date: Date; key: string }

function buildWeekDays(): DayInfo[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    return { date: d, key: d.toISOString().slice(0, 10) }
  })
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'now'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    return `${d}d ${h % 24}h`
  }
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ────────────────────────── data layer ──────────────────────────
// Coalesce all 6 paginated fetches behind a single React Query key so a
// re-mount doesn't refetch the whole week. Cached for 10 minutes.
async function fetchWeek(days: DayInfo[]): Promise<AiringSchedule[]> {
  const from = Math.floor(days[0].date.getTime() / 1000)
  const to = Math.floor(days[6].date.getTime() / 1000) + 86400
  const all: AiringSchedule[] = []
  for (let page = 1; page <= 6; page++) {
    try {
      const res = await getAiringSchedule(from, to, page, 50)
      if (!res) break
      all.push(...res.items)
      if (!res.hasNextPage) break
    } catch (e) {
      console.warn(`[schedule] page ${page} failed:`, (e as Error).message)
      // If even the first page fails, throw so React Query shows error state
      // instead of silently showing an empty schedule.
      if (page === 1) throw e
      break
    }
  }
  return all
}

export default function Schedule() {
  const days = useMemo(buildWeekDays, [])
  const [activeIdx, setActiveIdx] = useState(0)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [onlyMyList, setOnlyMyList] = useState(false)
  const watchlist = useWatchListStore((s) => s.watchlist)
  const watchlistMalIds = useMemo(
    () => new Set(watchlist.map((a) => a.mal_id)),
    [watchlist],
  )

  useTitle('Schedule')

  // Tick once per minute so countdowns stay fresh
  useEffect(() => {
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 60 * 1000)
    return () => window.clearInterval(t)
  }, [])

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['schedule', days[0].key],
    queryFn: () => fetchWeek(days),
    staleTime: 10 * 60 * 1000,
    meta: { persist: true },
  })

  // Group items by day, filter, sort by time
  const itemsByDay = useMemo(() => {
    const map: Record<string, AiringSchedule[]> = {}
    for (const d of days) map[d.key] = []
    for (const item of items) {
      if (onlyMyList && item.media.idMal && !watchlistMalIds.has(item.media.idMal)) continue
      const dt = new Date(item.airingAt * 1000)
      dt.setHours(0, 0, 0, 0)
      const key = dt.toISOString().slice(0, 10)
      if (map[key]) map[key].push(item)
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => a.airingAt - b.airingAt)
    }
    return map
  }, [items, days, onlyMyList, watchlistMalIds])

  const todayKey = days[0].key
  const todayItems = itemsByDay[todayKey] || []
  const nextToday = useMemo(
    () => todayItems.find((i) => i.airingAt > now),
    [todayItems, now],
  )

  const activeDay = days[activeIdx]
  const list = itemsByDay[activeDay.key] || []
  const totalThisWeek = items.length
  const watchlistCount = watchlistMalIds.size

  return (
    <div className="pt-20 pb-12">
      <div className="max-w-[1600px] mx-auto px-4">
        {/* ───── Header card ───── */}
        <div className="glass-card rounded-2xl p-5 mb-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center">
                <CalendarDays className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white leading-tight">
                  Airing Schedule
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {totalThisWeek > 0
                    ? `${totalThisWeek} episodes across 7 days · powered by AniList`
                    : 'Episodes airing this week · powered by AniList'}
                </p>
              </div>
            </div>

            {/* "My list only" toggle */}
            {watchlistCount > 0 && (
              <button
                onClick={() => setOnlyMyList((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                  onlyMyList
                    ? 'bg-primary text-white border-primary shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.5)]'
                    : 'bg-white/[0.04] text-white/70 border-white/8 hover:bg-white/[0.08] hover:text-white',
                )}
                title="Show only shows from your watchlist"
              >
                <Filter className="h-3.5 w-3.5" />
                My list only
                {onlyMyList && <X className="h-3 w-3 ml-0.5 opacity-70" />}
              </button>
            )}
          </div>
        </div>

        {/* ───── Split view ───── */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 items-start">

          {/* ━━━━━ LEFT: rail ━━━━━ */}
          <aside className="lg:sticky lg:top-20 space-y-3">
            {/* "Up next" snapshot */}
            <div className="glass-card rounded-xl p-3 relative overflow-hidden">
              <div className="flex items-center gap-2 mb-2.5">
                <Radio className="h-3.5 w-3.5 text-primary animate-pulse" />
                <span className="text-[10px] uppercase tracking-wider font-bold text-primary">
                  Up next today
                </span>
              </div>
              {isLoading && !nextToday ? (
                <div className="flex items-center gap-2.5">
                  <div className="h-14 w-10 rounded shimmer shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="h-3 w-3/4 rounded shimmer" />
                    <div className="h-2 w-1/2 rounded shimmer" />
                  </div>
                </div>
              ) : nextToday ? (
                <Link
                  to={nextToday.media.idMal ? `/anime/${nextToday.media.idMal}` : '#'}
                  className="group flex items-center gap-2.5"
                >
                  <div className="h-14 w-10 shrink-0 rounded overflow-hidden bg-black/40">
                    {nextToday.media.coverImage.large && (
                      <img
                        src={nextToday.media.coverImage.large}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate group-hover:text-primary transition-colors leading-tight">
                      {nextToday.media.title.english || nextToday.media.title.romaji}
                    </p>
                    <p className="text-[10px] font-mono text-accent flex items-center gap-1 mt-1">
                      <Bell className="h-2.5 w-2.5" />
                      in {formatCountdown(nextToday.airingAt - now)} · EP {nextToday.episode}
                    </p>
                  </div>
                </Link>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nothing else airing today.
                </p>
              )}
            </div>

            {/* Day list */}
            <div className="glass-card rounded-xl p-2 space-y-1">
              {days.map((d, i) => {
                const dayItems = itemsByDay[d.key] || []
                const myCount = dayItems.filter(
                  (it) => it.media.idMal && watchlistMalIds.has(it.media.idMal),
                ).length
                const isActive = i === activeIdx
                const isToday = i === 0
                return (
                  <button
                    key={d.key}
                    onClick={() => setActiveIdx(i)}
                    className={cn(
                      'group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all border',
                      isActive
                        ? 'bg-primary/15 border-primary/40'
                        : 'bg-transparent border-transparent hover:bg-white/5',
                    )}
                  >
                    <div
                      className={cn(
                        'flex flex-col items-center justify-center w-11 h-11 rounded-lg shrink-0 font-mono text-[10px] uppercase tracking-wider transition-colors',
                        isActive
                          ? 'bg-primary text-white shadow-[0_4px_12px_-4px_hsl(245,75%,60%,0.5)]'
                          : 'bg-white/5 text-muted-foreground group-hover:bg-white/10 group-hover:text-white',
                      )}
                    >
                      <span className="text-[10px] opacity-80 leading-none">
                        {isToday ? 'Today' : DAY_NAMES[d.date.getDay()]}
                      </span>
                      <span className="text-base font-bold leading-none mt-0.5">
                        {d.date.getDate()}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        'text-xs font-semibold',
                        isActive ? 'text-white' : 'text-white/80',
                      )}>
                        {DAY_LABELS[d.date.getDay()]}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-[10px] text-muted-foreground">
                          {dayItems.length === 0
                            ? 'No episodes'
                            : `${dayItems.length} episode${dayItems.length === 1 ? '' : 's'}`}
                        </p>
                        {myCount > 0 && (
                          <span
                            title={`${myCount} from your list`}
                            className="flex items-center gap-0.5 text-[9px] font-mono font-bold text-primary"
                          >
                            <Bell className="h-2 w-2" />
                            {myCount}
                          </span>
                        )}
                      </div>
                    </div>
                    {isActive && (
                      <ChevronRight className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          </aside>

          {/* ━━━━━ RIGHT: timeline ━━━━━ */}
          <section className="min-w-0">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <Calendar className="h-4 w-4 text-primary shrink-0" />
                <h2 className="text-lg font-semibold text-white">
                  {DAY_LABELS[activeDay.date.getDay()]}
                </h2>
                <span className="text-sm text-muted-foreground">
                  · {activeDay.date.toLocaleDateString(undefined, {
                    month: 'long', day: 'numeric',
                  })}
                </span>
              </div>
              {list.length > 0 && (
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {list.length} episode{list.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {isLoading && list.length === 0 ? (
              // Skeleton timeline
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl glass-card">
                    <div className="h-16 w-12 rounded-md shimmer shrink-0" />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="h-3 w-1/3 rounded shimmer" />
                      <div className="h-4 w-3/4 rounded shimmer" />
                      <div className="h-2 w-1/4 rounded shimmer" />
                    </div>
                  </div>
                ))}
              </div>
            ) : list.length === 0 ? (
              <div className="glass-card rounded-2xl py-16 text-center">
                <Tv className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-white/80 font-semibold mb-1">
                  {onlyMyList
                    ? 'Nothing from your list airs this day'
                    : 'No episodes scheduled'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {onlyMyList
                    ? 'Try another day or turn off the filter'
                    : 'Try another day in the rail'}
                </p>
              </div>
            ) : (
              <div className="relative">
                {/* Vertical timeline rail */}
                <div
                  className="absolute left-[26px] top-0 bottom-0 w-px bg-gradient-to-b from-white/8 via-white/4 to-transparent"
                  aria-hidden
                />

                <div className="space-y-3">
                  {list.map((entry, i) => {
                    const t = new Date(entry.airingAt * 1000)
                    const time = t.toLocaleTimeString([], {
                      hour: '2-digit', minute: '2-digit',
                    })
                    const secsUntil = entry.airingAt - now
                    const isAired = secsUntil <= 0
                    const isAiringSoon = !isAired && secsUntil < 3600
                    const title = entry.media.title.english || entry.media.title.romaji
                    const href = entry.media.idMal
                      ? `/anime/${entry.media.idMal}`
                      : undefined
                    const inMyList =
                      entry.media.idMal && watchlistMalIds.has(entry.media.idMal)
                    const score = entry.media.averageScore

                    const body = (
                      <div className={cn(
                        'group relative pl-14 pr-3 py-3 rounded-xl transition-all border',
                        isAiringSoon
                          ? 'bg-primary/10 border-primary/30 shadow-[0_4px_24px_-8px_hsl(245,75%,60%,0.4)]'
                          : inMyList
                            ? 'bg-accent/5 border-accent/20 hover:bg-accent/10'
                            : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.05]',
                      )}>
                        {/* Timeline node */}
                        <div className={cn(
                          'absolute left-[19px] top-1/2 -translate-y-1/2 h-4 w-4 rounded-full border-2 grid place-items-center transition-all z-[1]',
                          isAiringSoon
                            ? 'bg-primary border-primary shadow-[0_0_10px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.6)]'
                            : isAired
                              ? 'bg-white/8 border-white/15'
                              : inMyList
                                ? 'bg-accent/25 border-accent/60'
                                : 'bg-card border-white/10 group-hover:border-primary/40',
                        )}>
                          {isAiringSoon && (
                            <Radio className="h-2.5 w-2.5 text-white animate-pulse" />
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="relative h-16 w-12 shrink-0 rounded-md overflow-hidden bg-black/40">
                            {entry.media.coverImage.large && (
                              <img
                                src={entry.media.coverImage.large}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                              <span className={cn(
                                'glass-pill text-[10px] font-mono uppercase tracking-wider font-semibold',
                                isAired
                                  ? 'text-muted-foreground'
                                  : isAiringSoon
                                    ? 'bg-primary text-white'
                                    : 'bg-accent/20 text-accent',
                              )}>
                                <Clock className="h-2.5 w-2.5" /> {time}
                              </span>
                              <span className="glass-pill text-[10px] font-mono text-muted-foreground font-semibold">
                                EP {entry.episode}
                              </span>
                              {!isAired && (
                                <span className={cn(
                                  'text-[10px] font-mono',
                                  isAiringSoon
                                    ? 'text-primary font-bold'
                                    : 'text-muted-foreground',
                                )}>
                                  · in {formatCountdown(secsUntil)}
                                </span>
                              )}
                              {entry.media.format && (
                                <span className="glass-pill text-[10px] text-muted-foreground">
                                  {entry.media.format}
                                </span>
                              )}
                              {inMyList && (
                                <span className="ml-auto glass-pill text-[9px] font-bold uppercase tracking-wider bg-accent/15 text-accent border-accent/30">
                                  In list
                                </span>
                              )}
                            </div>
                            <p className={cn(
                              'text-sm font-semibold truncate',
                              isAired ? 'text-white/70' : 'text-white',
                            )}>
                              {title}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {score && (
                                <span className="flex items-center gap-0.5 text-[10px] text-yellow-400 font-semibold">
                                  <Star className="h-2.5 w-2.5 fill-yellow-400" />
                                  {(score / 10).toFixed(1)}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground truncate">
                                {entry.media.genres?.slice(0, 3).join(' · ')}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )

                    return href ? (
                      <StaggerCard key={entry.id} index={i}>
                      <Link to={href} className="block">{body}</Link>
                      </StaggerCard>
                    ) : (
                      <StaggerCard key={entry.id} index={i}>
                      <div>{body}</div>
                      </StaggerCard>
                    )
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
