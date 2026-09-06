import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion'
import { Play, Clock, Star, ChevronLeft, ChevronRight, Calendar, Film, Tv } from 'lucide-react'
import { getTrending, getAiringSchedule } from '../api/anilist'
import { getTmdbBackdrop, getAnimeLogo } from '../api/tmdb'
import { preloadHandlers } from '../lib/routePreloaders'
import { useSettings } from '../store/useSettings'
import { useShallow } from 'zustand/react/shallow'
import { cn, proxifyImgUrl } from '../lib/utils'

const CROSSFADE_MS = 12000 // 12s between auto-advance

// ── Mini countdown ticker for the schedule strip ──────────────────
function MiniTicker({ targetAt }: { targetAt: number }) {
  const [left, setLeft] = useState(() => targetAt - Math.floor(Date.now() / 1000))

  useEffect(() => {
    const t = setInterval(() => setLeft(targetAt - Math.floor(Date.now() / 1000)), 60_000)
    return () => clearInterval(t)
  }, [targetAt])

  if (left <= 0) return <span className="text-emerald-400 font-semibold">Airing</span>

  const d = Math.floor(left / 86400)
  const h = Math.floor((left % 86400) / 3600)
  const m = Math.floor((left % 3600) / 60)

  if (d > 0) return <span>in {d}d {h}h</span>
  if (h > 0) return <span>in {h}h {m}m</span>
  return <span>in {m}m</span>
}

/**
 * Kurōdo home hero — anikage-style cinematic spotlight.
 *
 * One full-bleed Featured slideshow (trending), no tabs:
 *   - TMDB clear-logo (with wordmark fallback) + native title
 *   - Meta pills with icons (score · year · episodes · format) — anikage style
 *   - Genre chips, 2–3 line synopsis
 *   - Watch Now / More Info CTAs
 *   - Progress dots + prev/next + counter (bottom, above the schedule ribbon)
 *   - Schedule ribbon ("Up Next") along the very bottom
 * Continue Watching + Editor's Pick now live as their own sections on Home
 * (the hero used to host them as tabs — see FeaturedPicks.tsx).
 */
export default function Hero() {
  // ── Featured slideshow data ────────────────────────────────────
  // Shared with the Home "Trending Now" row (['feed','trending']) so both
  // consume ONE AniList request. We only render the first few backdrops.
  const { data: featuredData } = useQuery({
    queryKey: ['feed', 'trending'],
    queryFn: () => getTrending(18),
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })

  // Schedule ribbon — next 7 days
  const nowSec = Math.floor(Date.now() / 1000)
  const { data: scheduleData } = useQuery({
    queryKey: ['hero-schedule'],
    queryFn: () => getAiringSchedule(nowSec, nowSec + 7 * 86400, 1, 8),
    staleTime: 5 * 60 * 1000,
  })
  const upcomingEpisodes = (scheduleData?.items ?? []).filter((e) => e.media.idMal).slice(0, 5)

  const [bgIndex, setBgIndex] = useState(0)
  const [logoFailed, setLogoFailed] = useState(false)

  // ── Parallax scroll: backdrop drifts slower than foreground ──
  const heroRef = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  })
  const backdropY = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
  const backdropScale = useTransform(scrollYProgress, [0, 1], [1, 1.15])

  // ── Backdrops (AniList fallback only if TMDB misses) ──────────
  const backdrops = useMemo(
    () => (featuredData ?? []).filter((m) => m.coverImage.large).slice(0, 6),
    [featuredData],
  )
  const current = backdrops[bgIndex] ?? null

  // Kick a background download so a logo is cache-warm before it renders.
  const warmImage = (url: string) => {
    if (typeof window === 'undefined' || !url) return
    const im = new Image()
    im.fetchPriority = 'high'
    im.src = url
  }

  // ── TMDB logo resolve + prewarm for EVERY slide ─────────────────
  // Each slide's transparent title logo is resolved through react-query
  // (6h localStorage persistence = instant on re-visits) AND its image
  // bytes are warmed the moment the URL is known. That way the carousel
  // crossfade never waits: by the time a slide is on screen its logo is
  // already sitting in the browser + server cache.
  const queryClient = useQueryClient()
  useEffect(() => {
    const slides = backdrops.slice(0, 6)
    slides.forEach((m, i) => {
      const key = ['tmdbLogo', m.title.english || m.title.romaji]
      const cached = queryClient.getQueryData<string | null>(key)
      if (cached != null) {
        // Already resolved (this session or persisted) — just warm the bytes.
        if (cached) warmImage(cached)
        return
      }
      // Small stagger keeps the TMDB burst polite, but slide 0 starts
      // immediately and the crossfade interval is far longer than this.
      const delay = i * 350
      setTimeout(() => {
        void queryClient
          .prefetchQuery({
            queryKey: key,
            queryFn: () =>
              getAnimeLogo({
                english: m.title.english ?? null,
                romaji: m.title.romaji ?? '',
              }),
            staleTime: 24 * 60 * 60 * 1000,
            meta: { persist: true },
          })
          .then((url) => {
            if (typeof url === 'string' && url) warmImage(url)
          })
      }, delay)
    })
  }, [backdrops, queryClient])

  // ── Auto crossfade ─────────────────────────────────────────────
  useEffect(() => {
    if (backdrops.length <= 1) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setInterval(() => setBgIndex((i) => (i + 1) % backdrops.length), CROSSFADE_MS)
    return () => window.clearInterval(t)
  }, [backdrops.length])

  const title = current?.title.english || current?.title.romaji || ''
  const year = current?.seasonYear ?? null
  const score = current?.averageScore != null ? Math.round(current.averageScore) : null

  // Reset logo error state when title changes (new carousel item)
  useEffect(() => { setLogoFailed(false) }, [title])

  const { reduceMotion, reduceQuality } = useSettings(
    useShallow((s) => ({ reduceMotion: s.reduceMotion, reduceQuality: s.reduceQuality })),
  )
  const skipHeroStagger = reduceMotion || reduceQuality

  // Word-stagger variants for the hero title fallback (when no TMDB logo)
  const titleContainerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.04, delayChildren: 0.1 },
    },
  }
  const titleWordVariants = {
    hidden: { opacity: 0, y: 12 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring', damping: 20, stiffness: 120 },
    },
  }

  // ── TMDB high-quality backdrop ─────────────────────────────────
  const { data: tmdbBackdrop } = useQuery({
    queryKey: ['tmdbBackdrop', title],
    queryFn: () => getTmdbBackdrop(title),
    enabled: !!title,
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })

  // ── TMDB title logo (transparent PNG) ───────────────────────────
  const { data: tmdbLogoUrl } = useQuery({
    queryKey: ['tmdbLogo', title],
    queryFn: () => getAnimeLogo({ english: current?.title.english ?? null, romaji: current?.title.romaji ?? '' }),
    enabled: !!title,
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })

  // Meta pills shared classes — anikage's "meta-pill-blur" glass chips
  const metaPill = 'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 backdrop-blur-md px-2.5 py-[5px] text-[11px] font-semibold text-white/80'
  const metaIcon = 'h-3 w-3 text-white/55'

  return (
    <section ref={heroRef} className="relative w-full h-[82vh] min-h-[640px] max-h-[900px] overflow-hidden bg-black">
      {/* ── Backdrop layer ─────────────────────────────────────── */}
      <motion.div className="absolute inset-0 z-0" style={{ y: backdropY, scale: backdropScale }}>
        <AnimatePresence mode="sync">
          {current && (() => {
            const staticSrc = proxifyImgUrl(
              tmdbBackdrop || current.bannerImage || current.coverImage.extraLarge || current.coverImage.large || '',
            )
            return (
              <motion.div
                key={current.id}
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1.0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1, ease: 'easeInOut' }}
                className="absolute inset-0"
              >
                {staticSrc ? (
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url('${staticSrc}')` }}
                  />
                ) : null}
              </motion.div>
            )
          })()}
        </AnimatePresence>

        {/* 3-layer cinema-grade vignette — anikage depth */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 80% 60% at 35% 40%, transparent 15%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.88) 100%),
              linear-gradient(90deg, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.6) 38%, rgba(0,0,0,0.08) 100%),
              linear-gradient(to top, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.42) 42%, transparent 68%)
            `,
          }}
        />
      </motion.div>

      {/* ── Foreground content ─────────────────────────────────── */}
      <div className="relative z-10 h-full flex flex-col">
        <div className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-8 lg:px-14 flex flex-col justify-end pb-24 sm:pb-28">
          <AnimatePresence mode="wait">
            {!current ? (
              <motion.div
                key="skeleton"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="space-y-4 mb-6 w-full max-w-2xl"
              >
                <div className="h-20 w-full bg-white/[0.06] rounded-lg shimmer" />
                <div className="h-4 w-2/3 bg-white/[0.05] rounded shimmer" />
                <div className="h-4 w-1/2 bg-white/[0.05] rounded shimmer" />
                <div className="h-12 w-64 bg-white/[0.05] rounded-lg shimmer" />
              </motion.div>
            ) : (
              <motion.div
                key={current.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{
                  duration: 0.55,
                  ease: [0.23, 1, 0.32, 1],
                  exit: { duration: 0.15, ease: 'easeIn' },
                }}
                className="max-w-3xl flex flex-col items-start"
              >
                {/* ── TMDB logo or wordmark title ───────────── */}
                {!logoFailed && tmdbLogoUrl ? (
                  <img
                    src={tmdbLogoUrl}
                    alt={title}
                    className="hero-logo mb-3"
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                    onError={() => setLogoFailed(true)}
                  />
                ) : skipHeroStagger ? (
                  <h1 className="hero-wordmark text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>
                    {title}
                  </h1>
                ) : (
                  <motion.h1
                    className="hero-wordmark flex flex-wrap text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight"
                    style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}
                    initial="hidden"
                    animate="visible"
                    variants={titleContainerVariants}
                  >
                    {title.split(/\s+/).filter(Boolean).map((word, i) => (
                      <motion.span
                        key={`${title}-${i}`}
                        className="mr-[0.25em] inline-block"
                        variants={titleWordVariants}
                      >
                        {word}
                      </motion.span>
                    ))}
                  </motion.h1>
                )}
                {current.title.native && (
                  <p className="mt-2 text-sm sm:text-base text-white/45 font-medium">
                    {current.title.native}
                  </p>
                )}

                {/* ── Meta pills — score · year · episodes · format ── */}
                <div className="flex flex-wrap items-center gap-2 mt-4 mb-4">
                  {score != null && (
                    <span className={cn(metaPill, 'text-amber-300')}>
                      <Star className={cn(metaIcon, 'fill-amber-300 text-amber-300')} />
                      {score}%
                    </span>
                  )}
                  {year && (
                    <span className={metaPill}>
                      <Calendar className={metaIcon} />
                      {year}
                    </span>
                  )}
                  {current.episodes != null && (
                    <span className={metaPill}>
                      <Film className={metaIcon} />
                      {current.episodes} Episodes
                    </span>
                  )}
                  {current.format && (
                    <span className={metaPill}>
                      <Tv className={metaIcon} />
                      {current.format.replace('_', ' ')}
                    </span>
                  )}
                </div>

                {/* ── Genre chips ─────────────────────────────── */}
                {current.genres.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mb-5">
                    {current.genres.slice(0, 4).map((g) => (
                      <span
                        key={g}
                        className="rounded-full border border-white/10 bg-white/[0.06] backdrop-blur-md px-3 py-1 text-[11px] sm:text-xs font-medium text-white/75"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                {/* ── 2–3 line synopsis (anikage keeps it tight) ── */}
                {current.description && (
                  <p className="text-[13px] sm:text-[15px] text-white/80 max-w-2xl line-clamp-2 md:line-clamp-3 leading-relaxed mb-7">
                    {current.description.replace(/<[^>]*>/g, '')}
                  </p>
                )}

                {/* ── Watch Now + More Info ───────────────────── */}
                <div className="flex flex-wrap items-center gap-3">
                  {current.idMal && (
                    <motion.div
                      whileHover={{ scale: 1.04, y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                    >
                      <Link
                        to={`/watch/${current.idMal}?ep=1`}
                        {...preloadHandlers('/watch/x')}
                        className="group inline-flex items-center justify-center gap-2 bg-white hover:bg-white/90 text-black h-11 px-8 rounded-full font-bold text-sm shadow-lg shadow-white/20"
                      >
                        <Play className="h-4 w-4 fill-black transition-transform group-hover:scale-110" />
                        Watch Now
                      </Link>
                    </motion.div>
                  )}
                  {current.idMal && (
                    <motion.div
                      whileHover={{ scale: 1.04, y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                    >
                      <Link
                        to={`/anime/${current.idMal}`}
                        {...preloadHandlers('/anime/x')}
                        className="group inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white h-11 px-6 rounded-full font-semibold text-sm border border-white/15 backdrop-blur-md"
                      >
                        More Info
                      </Link>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Slide controls — anikage style ───────────────────────── */}
      {backdrops.length > 1 && (
        <>
          {/* Bottom-left: progress dashes */}
          <div
            className={cn(
              'absolute left-4 sm:left-8 lg:left-14 z-20 flex items-center gap-1.5',
              upcomingEpisodes.length > 0 ? 'bottom-[72px] sm:bottom-[80px]' : 'bottom-6 sm:bottom-8',
            )}
          >
            {backdrops.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setBgIndex(i)}
                aria-label={`Show ${m.title.english || m.title.romaji}`}
                className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  i === bgIndex ? 'w-8 bg-white' : 'w-4 bg-white/30 hover:bg-white/55',
                )}
              />
            ))}
          </div>

          {/* Bottom-right: counter + prev/next arrows */}
          <div
            className={cn(
              'absolute right-4 sm:right-8 lg:right-14 z-20 flex items-center gap-3',
              upcomingEpisodes.length > 0 ? 'bottom-[68px] sm:bottom-[76px]' : 'bottom-5 sm:bottom-7',
            )}
          >
            <span className="text-[13px] font-semibold text-white/80 tabular-nums tracking-wide">
              {(bgIndex + 1).toString().padStart(2, '0')}
              <span className="text-white/35"> / </span>
              {backdrops.length.toString().padStart(2, '0')}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setBgIndex((bgIndex - 1 + backdrops.length) % backdrops.length)}
                aria-label="Previous"
                className="h-9 w-9 rounded-full border border-white/15 bg-black/60 grid place-items-center text-white/70 hover:text-white hover:bg-white/10 transition-all duration-150"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setBgIndex((bgIndex + 1) % backdrops.length)}
                aria-label="Next"
                className="h-9 w-9 rounded-full border border-white/15 bg-black/60 grid place-items-center text-white/70 hover:text-white hover:bg-white/10 transition-all duration-150"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Compact schedule ribbon (anikage-served "Up Next") ────── */}
      {upcomingEpisodes.length > 0 && (
        <div className="absolute bottom-0 left-0 w-full h-14 bg-black/85 border-t border-white/[0.06] flex items-center px-4 sm:px-8 z-30 overflow-x-auto custom-scrollbar">
          <div className="flex items-center gap-5 w-max min-w-full">
            <div className="shrink-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/40">
              <Clock className="h-3.5 w-3.5" />
              Up Next
            </div>

            {upcomingEpisodes.map((item) => {
              const displayTitle = item.media.title.english || item.media.title.romaji
              return (
                <Link
                  key={item.id}
                  to={item.media.idMal ? `/anime/${item.media.idMal}` : '#'}
                  className="flex items-center gap-2.5 group shrink-0 hover:bg-white/[0.06] px-2 py-1 -mx-1 rounded-lg border border-transparent hover:border-white/[0.06] transition-all"
                >
                  {item.media.coverImage?.large && (
                    <img
                      src={proxifyImgUrl(item.media.coverImage.large.replace(/\/large\//, '/medium/'))}
                      alt=""
                      className="w-8 h-8 rounded object-cover shadow-sm bg-zinc-900 shrink-0"
                    />
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-medium text-white/85 line-clamp-1 max-w-[140px] group-hover:text-white transition-colors">
                      {displayTitle}
                    </span>
                    <span className="text-[10px] text-white/45 flex items-center gap-1">
                      <span>EP {item.episode}</span>
                      <span>·</span>
                      <MiniTicker targetAt={item.airingAt} />
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
