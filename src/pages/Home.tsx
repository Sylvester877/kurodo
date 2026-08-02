import { useRef, useEffect, useState, memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'
import HomePageParallax from '../components/HomePageParallax'
import {
  getTrending, getThisSeason, getUpcoming, getAllTimeTop,
  type FeedMedia,
} from '../api/anilist'
import { feedToAnimeList } from '../lib/adapters'
import Hero from '../components/Hero'
import AnimeCard from '../components/AnimeCard'
import RecentEpisodes from '../components/RecentEpisodes'
import ContinueWatchingRail from '../components/ContinueWatchingRail'
import MangaContinueReadingRail from '../components/MangaContinueReadingRail'
import TopHundred from '../components/TopHundred'
import SubDubToggle, { filterBySubDub } from '../components/SubDubToggle'
import SectionHeader from '../components/SectionHeader'
import BackToTop from '../components/BackToTop'
import ScrollReveal from '../components/ScrollReveal'
import GenreTiles from '../components/GenreTiles'
import SeasonalCountdown from '../components/SeasonalCountdown'
import { SkeletonRow } from '../components/Skeleton'
import StaggerCard from '../components/StaggerCard'
import { useSettings } from '../store/useSettings'
import { useTitle } from '../hooks/useTitle'

// ── Intro tracking key ───────────────────────────────────────────
// (INTRO_KEY removed — was the gate for the now-deleted cinematic intro animation)

interface Section {
  key: string
  kicker: string
  title: string
  subtitle: string
  link: string
  fetcher: () => Promise<FeedMedia[]>
  pill?: string
  pillTone?: 'hot' | 'seasonal' | 'top' | 'upcoming'
}

const SECTIONS: Section[] = [
  {
    key: 'trending',
    kicker: 'Trending',
    title: 'Trending Now',
    subtitle: 'What the community is watching right now',
    link: '/browse?filter=top-rated',
    fetcher: () => getTrending(18),
    pill: 'HOT',
    pillTone: 'hot',
  },
  {
    key: 'thisSeason',
    kicker: 'Seasonal',
    title: 'Popular This Season',
    subtitle: 'Currently airing — the best of what’s on',
    link: '/browse?filter=seasonal',
    fetcher: () => getThisSeason(18),
    pill: 'SEASONAL',
    pillTone: 'seasonal',
  },
  {
    key: 'mostFavorite',
    kicker: 'Community',
    title: 'Most Favorite',
    subtitle: 'The all-time community favorites',
    link: '/browse?filter=top-rated',
    fetcher: () => getAllTimeTop(18),
    pill: 'ELITE',
    pillTone: 'top',
  },
  {
    key: 'upcoming',
    kicker: 'On the horizon',
    title: 'Coming Soon',
    subtitle: 'Next season\'s most anticipated releases',
    link: '/browse?filter=upcoming',
    fetcher: () => getUpcoming(18),
    pill: 'UPCOMING',
    pillTone: 'upcoming',
  },
]

const FeedSection = memo(function FeedSection({ section }: { section: Section }) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const subDubFilter = useSettings((s) => s.subDubFilter)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['feed', section.key],
    queryFn: section.fetcher,
    staleTime: 15 * 60 * 1000,
    meta: { persist: true },
  })
  const animes = data ? filterBySubDub(feedToAnimeList(data), subDubFilter) : []

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <section ref={ref} className="mt-8 mx-4">
      <motion.div
        initial={reduceMotion ? {} : { opacity: 0, y: 16 }}
        animate={visible || reduceMotion ? { opacity: 1, y: 0 } : {}}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
      >
        <SectionHeader
          title={section.title}
          to={section.link}
          pill={section.pill}
          pillTone={section.pillTone}
        />
      </motion.div>

      {isLoading && animes.length === 0 ? (
        <SkeletonRow count={7} />
      ) : isError && animes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-10 rounded-2xl bg-white/[0.02] border border-white/5">
          <p className="text-sm text-muted-foreground">
            Couldn’t load this row — AniList may be busy.
          </p>
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5 contain-auto">
          {animes.slice(0, 14).map((anime, i) => (
            <StaggerCard key={anime.mal_id} index={i}>
              <AnimeCard anime={anime} magnetic quickActions />
            </StaggerCard>
          ))}
        </div>
      )}
    </section>
  )
})

export default function Home() {
  useTitle('Discover')

  return (
    <div className="pb-12 relative page-enter">
      {/* ── Scroll-driven parallax ambient background ───────────── */}
      <HomePageParallax />

      {/* ── Hero with integrated schedule ribbon ─────────────────── */}
      <Hero />

      {/* Sub/Dub filter bar — anidap-style quick filter */}
      <div className="mx-4 mt-4 flex items-center justify-end">
        <SubDubToggle />
      </div>

      {/* Continue Watching — right after hero, anikage-style */}
      <ScrollReveal>
        <ContinueWatchingRail />
      </ScrollReveal>

      {/* Seasonal countdown — shows days until next anime season */}
      <ScrollReveal delay={0.06}>
        <SeasonalCountdown />
      </ScrollReveal>

      {/* Recent Episodes — latest drops */}
      <ScrollReveal delay={0.08}>
        <RecentEpisodes />
      </ScrollReveal>

      {/* Explore by Genre — visual tile grid */}
      <ScrollReveal delay={0.1}>
        <GenreTiles />
      </ScrollReveal>

      {/* Top 10 — ranked list view */}
      <ScrollReveal delay={0.12}>
        <TopHundred />
      </ScrollReveal>

      {/* Manga Continue Reading rail */}
      <ScrollReveal delay={0.14}>
        <MangaContinueReadingRail />
      </ScrollReveal>

      {/* Main feed grids */}
      {SECTIONS.map((s) => (
        <FeedSection key={s.key} section={s} />
      ))}

      <BackToTop />
    </div>
  )
}
