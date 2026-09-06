import { memo, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import { getTrending } from '../api/anilist'
import { feedToAnimeList } from '../lib/adapters'
import { cn } from '../lib/utils'
import { useSettings } from '../store/useSettings'
import { useShallow } from 'zustand/react/shallow'
import AnimeCard from './AnimeCard'
import SectionHeader from './SectionHeader'
import { RailArrows, railNudge } from './RailPaging'
import { filterBySubDub } from './SubDubToggle'

/** Miruro-canon ghost numeral: huge outline type that sits behind the card. */
function GhostNumeral({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -top-7 -left-1 z-0 select-none font-black leading-none tracking-tighter
        bg-gradient-to-b from-white/[0.14] via-white/[0.07] to-transparent bg-clip-text text-transparent
        [-webkit-text-stroke:1px_rgba(255,255,255,0.10)]"
      style={{ fontSize: 'clamp(72px, 6vw, 104px)' }}
    >
      {String(n).padStart(2, '0')}
    </span>
  )
}

function RailSkeleton() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="shrink-0 w-[160px] relative pt-6">
          <div className="h-14 w-14 shimmer rounded-full absolute top-0 left-2 opacity-40" aria-hidden />
          <div className="aspect-[3/4] rounded-xl bg-card shimmer" />
        </div>
      ))}
    </div>
  )
}

/**
 * Trending Now — ghost-numeral rail (SITE-02 Miruro steal). The hottest
 * titles run horizontally with huge outline rank numerals peeking from
 * behind each poster. Shares the hero/feed trending query + sub/dub
 * filter; keeps the numbered feel of a Top-10 while staying a scrollable
 * rail. Renders nothing (safe) while loading fails — mirror of FeedSection.
 */
export default memo(function TrendingRail() {
  const ref = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const { reduceMotion, subDubFilter } = useSettings(
    useShallow((s) => ({ reduceMotion: s.reduceMotion, subDubFilter: s.subDubFilter })),
  )

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['feed', 'trending'],
    queryFn: () => getTrending(18),
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })

  const shown = data ? filterBySubDub(feedToAnimeList(data), subDubFilter) : []

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <section ref={ref} className="mt-7 mx-3 sm:mx-4">
      <motion.div
        initial={reduceMotion ? {} : { opacity: 0, y: 16 }}
        animate={visible || reduceMotion ? { opacity: 1, y: 0 } : {}}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
      >
        <div className="flex items-end justify-between gap-4">
          <SectionHeader
            kicker="Trending"
            title="Trending Now"
            subtitle="What the community is watching right now"
            pill="HOT"
            pillTone="hot"
            to="/browse?filter=top-rated"
          />
          <div className="hidden sm:block pb-1">
            <RailArrows
              onPrev={() => railNudge(scrollerRef.current, -1)}
              onNext={() => railNudge(scrollerRef.current, 1)}
            />
          </div>
        </div>
      </motion.div>

      {isLoading && shown.length === 0 ? (
        <RailSkeleton />
      ) : isError && shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 rounded-2xl bg-white/[0.02] border border-white/5">
          <p className="text-sm text-muted-foreground">Couldn’t load this row — AniList may be busy.</p>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="glass-pill text-xs disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            {isFetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="flex gap-4 overflow-x-auto custom-scrollbar pt-8 pb-3 -mx-1 px-1 contain-auto"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {shown.map((anime, i) => (
            <div
              key={anime.mal_id}
              className="relative shrink-0 w-[150px] sm:w-[168px]"
              style={{ scrollSnapAlign: 'start' }}
            >
              <GhostNumeral n={i + 1} />
              <div className="relative z-10">
                <AnimeCard anime={anime} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
})
