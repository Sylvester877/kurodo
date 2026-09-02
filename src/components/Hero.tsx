import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion'
import { Play, Clock, X, RotateCcw, Star, ChevronLeft, ChevronRight } from 'lucide-react'
import { getTrending, getAiringSchedule, getAllTimeTop } from '../api/anilist'
import { getTmdbBackdrop, getAnimeLogo } from '../api/tmdb'
import { preloadHandlers } from '../lib/routePreloaders'
import { useWatchListStore } from '../store/useWatchListStore'
import { useSettings } from '../store/useSettings'
import { useShallow } from 'zustand/react/shallow'
import { cn, getImageUrl, proxifyImgUrl } from '../lib/utils'

const CROSSFADE_MS = 12000 // 12s between auto-advance

interface Props {
  /** @deprecated Reserved for future use; currently no-op. */
  intro?: boolean
}

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
 * Anikage-style landing hero — full-bleed carousel with tabs.
 *
 *   - Three tabs: Continue Watching | Featured | Editor's Pick
 *   - Continue Watching: horizontal scroll rail of resume cards
 *   - Featured: trending carousel (existing crossfade backdrops)
 *   - Editor's Pick: all-time top-rated carousel
 *   - Percentage score in circular ring (anikage style)
 *   - Glass-pill badges: format, year, duration, episodes
 *   - HOT badge on featured section
 *   - Genres as comma-separated text
 *   - Numbered carousel dots "01 / 06" with linear progress bar
 *   - Full description (line-clamp-3/4)
 *   - Watch Now / More Info / My List / Trailer buttons
 *   - TMDB logo with typographic fallback
 *   - Schedule ribbon at bottom (Up Next with countdowns)
 *   - Trending rail at bottom-right
 *   - Starfield, nebula, noise overlay
 *   - Search bar with ⌘K
 */
export default function Hero(_props: Props = {}) {
  // Continue Watching data
  const continueWatching = useWatchListStore((s) => s.continueWatching)
  const removeFromContinue = useWatchListStore((s) => s.removeFromContinue)
  const getEpisodeProgress = useWatchListStore((s) => s.getEpisodeProgress)
  const clearEpisodeProgress = useWatchListStore((s) => s.clearEpisodeProgress)

  // ── Tab state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'continue' | 'featured' | 'editors'>('featured')
  const [bgFeatured, setBgFeatured] = useState(0)
  const [bgEditors, setBgEditors] = useState(0)
  const [logoFailed, setLogoFailed] = useState(false)

  // ── Data queries ───────────────────────────────────────────────
  // Request perPage 18 (same as the Home feed rows) so the underlying
  // AniList call is DEDUPED with the "Trending Now" / "Most Favorite"
  // sections instead of firing its own near-duplicate request. We only
  // render the first few backdrops, so the extra rows cost nothing.
  const { data: featuredData, isLoading: isLoadingFeatured } = useQuery({
    // Shared with the Home "Trending Now" row (['feed','trending']) so
    // both consume ONE AniList request — the hero no longer doubles the
    // traffic for the top feed section.
    queryKey: ['feed', 'trending'],
    queryFn: () => getTrending(18),
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })
  const { data: editorsData, isLoading: isLoadingEditors } = useQuery({
    // Shared with the Home "Most Favorite" row (['feed','mostFavorite']).
    queryKey: ['feed', 'mostFavorite'],
    queryFn: () => getAllTimeTop(18),
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

  // ── Parallax scroll: backdrop drifts slower than foreground ──
  const heroRef = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  })
  const backdropY = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
  const backdropScale = useTransform(scrollYProgress, [0, 1], [1, 1.15])

  // ── Backdrops ──────────────────────────────────────────────────
  // TMDB provides high-quality backdrops, so relax the filter — we only
  // need a minimal AniList fallback in case TMDB misses.
  const featuredBackdrops = useMemo(
    () => (featuredData ?? []).filter((m) => m.coverImage.large).slice(0, 6),
    [featuredData],
  )
  const editorsBackdrops = useMemo(
    () => (editorsData ?? []).filter((m) => m.coverImage.large).slice(0, 6),
    [editorsData],
  )

  const isFeatured = activeTab === 'featured'
  const currentBackdrops = activeTab === 'continue' ? [] : isFeatured ? featuredBackdrops : editorsBackdrops
  const currentIndex = isFeatured ? bgFeatured : bgEditors
  const current = currentBackdrops[currentIndex] ?? null

  // ── TMDB logo prefetch: warm the React Query cache for the first 2
  //    trending + editors-pick anime so the hero logo is instant when
  //    the carousel reaches those items (instead of waiting 5s for two
  //    sequential TMDB API calls). Staggered 500ms apart to avoid
  //    flooding the TMDB API with 4 concurrent search+images requests.
  const queryClient = useQueryClient()
  useEffect(() => {
    const titles = [
      ...featuredBackdrops.slice(0, 2).map((m) => ({ english: m.title.english ?? null, romaji: m.title.romaji ?? '' })),
      ...editorsBackdrops.slice(0, 2).map((m) => ({ english: m.title.english ?? null, romaji: m.title.romaji ?? '' })),
    ]
    for (let i = 0; i < titles.length; i++) {
      const t = titles[i]
      const key = ['tmdbLogo', t.english || t.romaji]
      // Only prefetch if not already in cache
      if (!queryClient.getQueryData(key)) {
        setTimeout(() => {
          queryClient.prefetchQuery({
            queryKey: key,
            queryFn: () => getAnimeLogo(t),
            staleTime: 24 * 60 * 60 * 1000,
            meta: { persist: true },
          })
        }, i * 500)
      }
    }
  }, [featuredBackdrops, editorsBackdrops, queryClient])

  // ── Auto crossfade ─────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'continue') return
    if (currentBackdrops.length <= 1) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setInterval(() => {
      if (isFeatured) setBgFeatured((i) => (i + 1) % featuredBackdrops.length)
      else setBgEditors((i) => (i + 1) % editorsBackdrops.length)
    }, CROSSFADE_MS)
    return () => window.clearInterval(t)
  }, [activeTab, featuredBackdrops.length, editorsBackdrops.length, isFeatured, currentBackdrops.length])

  // ── Handlers ──────────────────────────────────────────────────
  const onAdvance = (i: number) => {
    if (isFeatured) setBgFeatured(i)
    else setBgEditors(i)
  }

  const title = current?.title.english || current?.title.romaji || ''
  const year = current?.seasonYear ?? null
  const score = current?.averageScore != null ? Math.round(current.averageScore) : null

  // Reset logo error state when title changes (new carousel item)
  useEffect(() => { setLogoFailed(false) }, [title])

  const { reduceMotion, reduceQuality } = useSettings(
    useShallow((s) => ({ reduceMotion: s.reduceMotion, reduceQuality: s.reduceQuality })),
  )
  const skipHeroStagger = reduceMotion || reduceQuality

  // Word-stagger variants for the hero title. Splitting by word (not
  // character) keeps DOM node count low for long anime titles.
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
    enabled: !!title && activeTab !== 'continue',
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })

  // ── TMDB title logo (transparent PNG) ───────────────────────────
  const { data: tmdbLogoUrl } = useQuery({
    queryKey: ['tmdbLogo', title],
    queryFn: () => getAnimeLogo({ english: current?.title.english ?? null, romaji: current?.title.romaji ?? '' }),
    enabled: !!title && activeTab !== 'continue',
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })

  // YouTube trailer is disabled — too many users reported unwanted auto-play.
  // Static TMDB backdrops provide the cinematic background without loading video.
  const trailerEmbedUrl = null as string | null

  return (
    <section ref={heroRef} className="relative w-full h-screen overflow-hidden bg-black">
      {/* ── Backdrop + trailer layer ─────────────────────────────── */}
      <motion.div className="absolute inset-0 z-0" style={{ y: backdropY, scale: backdropScale }}>
        {/* Auto-playing YouTube trailer or static TMDB backdrop */}
        <AnimatePresence mode="sync">
          {current && activeTab !== 'continue' && (() => {
            const staticSrc = tmdbBackdrop || current.bannerImage || current.coverImage.extraLarge || current.coverImage.large
            return (
              <motion.div
                key={`${activeTab}-${current.id}`}
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1.0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.1, ease: 'easeInOut' }}
                className="absolute inset-0"
              >
                {trailerEmbedUrl ? (
                  <>
                    {/* Trailer iframe — muted autoplay, covers entire hero */}
                    <div className="absolute inset-0 overflow-hidden bg-black">
                      <iframe
                        src={trailerEmbedUrl}
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{
                          width: '177.78vh',
                          height: '56.25vw',
                          minWidth: '100%',
                          minHeight: '100%',
                          border: 'none',
                        }}
                        allow="autoplay; encrypted-media"
                        title=""
                      />
                    </div>
                    {/* Extra darkening over the trailer so text remains readable */}
                    <div className="absolute inset-0 bg-black/30" />
                  </>
                ) : staticSrc ? (
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
              linear-gradient(90deg, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 35%, rgba(0,0,0,0.08) 100%),
              linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.4) 40%, transparent 65%)
            `,
          }}
        />


      </motion.div>

      {/* ── Foreground content ─────────────────────────────────────── */}
      <div className="relative z-10 h-full flex flex-col pt-8">
        <div className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-8 lg:px-14 flex flex-col justify-end pb-28 sm:pb-32">
          {/* ── Tab switcher ────────────────────────────────────── */}
          <div className="flex items-center gap-1 mb-4">
            {(
              [
                { key: 'continue', label: 'Continue Watching' },
                { key: 'featured', label: 'Featured' },
                { key: 'editors', label: "Editor's Pick" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  'px-3.5 min-h-[32px] inline-flex items-center rounded-full text-xs font-semibold transition-all',
                  activeTab === t.key
                    ? 'bg-white text-black'
                    : 'text-white/50 hover:text-white/80 hover:bg-white/10',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Continue Watching tab ───────────────────────────── */}
          {activeTab === 'continue' ? (
            <div className="w-full flex-1 flex flex-col justify-end pt-12"
              style={{
                background: 'linear-gradient(180deg, hsla(245,35%,8%,0.9) 0%, hsla(245,35%,5%,0.6) 50%, hsla(245,35%,4%,0.2) 100%)',
              }}
            >
              {continueWatching.length === 0 ? (
                <div className="text-white/50 text-sm font-medium pb-8 pl-2">
                  Nothing here yet… Start watching to see your progress!
                </div>
              ) : (
                <div
                  className="flex gap-4 overflow-x-auto custom-scrollbar pb-6 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory"
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
                        className="relative shrink-0 w-[280px] group snap-start"
                      >
                        <Link
                          to={watchUrl}
                          {...preloadHandlers('/watch/x')}
                          className="block glass-card rounded-xl overflow-hidden card-tilt"
                        >
                          <div className="relative aspect-video">
                            <img
                              src={proxifyImgUrl(getImageUrl(c.anime))}
                              alt={c.anime.title}
                              className="h-full w-full object-cover bg-black/20"
                              loading="lazy"
                              decoding="async"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                            {/* Hover play disc */}
                            <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="h-12 w-12 rounded-full bg-primary/95 grid place-items-center shadow-[0_0_30px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.6)]">
                                <Play className="h-5 w-5 text-white fill-white ml-0.5" />
                              </div>
                            </div>
                            {/* Bottom metadata */}
                            <div className="absolute bottom-2 left-2 right-2 space-y-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] font-mono font-bold text-accent">
                                  EP {c.episode}
                                </p>
                                {remaining != null && remaining > 0 && (
                                  <p className="text-[10px] font-mono text-white/85 bg-black/65 px-1.5 py-0.5 rounded">
                                    {fmtTime(remaining)} left
                                  </p>
                                )}
                              </div>
                              <p className="text-sm font-semibold text-white line-clamp-1">
                                {c.anime.title_english || c.anime.title}
                              </p>
                            </div>
                            {/* Progress bar */}
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

                        {/* Remove button */}
                        <button
                          type="button"
                          onClick={() => removeFromContinue(c.anime.mal_id)}
                          aria-label="Remove from continue watching"
                          title="Remove from list"
                          className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/75 text-white/80 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>

                        {/* Restart button */}
                        {prog && pct > 0.02 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              clearEpisodeProgress(c.anime.mal_id, c.episode)
                            }}
                            aria-label={`Start episode ${c.episode} over`}
                            title="Start episode over"
                            className="absolute top-2 left-2 h-7 px-2 rounded-full bg-black/75 text-white/85 inline-flex items-center gap-1 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/15 border border-white/10"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Restart
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── Featured / Editor's Pick carousel ──────────── */
            <AnimatePresence mode="wait">
              {(isLoadingFeatured || isLoadingEditors) || !current ? (
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
                  key={current.id + activeTab}
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
                  {/* ── TMDB logo or text title ──────────────── */}
                  {!logoFailed && tmdbLogoUrl ? (
                    <img
                      src={tmdbLogoUrl}
                      alt={title}
                      className="hero-logo mb-2"
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      onError={() => setLogoFailed(true)}
                    />
                  ) : skipHeroStagger ? (
                    <h1 className="hero-wordmark text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight" style={{ textShadow: '0 2px 8px rgba(0,0,0,0.7)' }}>
                      {title}
                    </h1>
                  ) : (
                    <motion.h1
                      className="hero-wordmark flex flex-wrap text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight"
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
                    <p className="mt-1.5 text-sm sm:text-base text-white/45 font-medium">
                      {current.title.native}
                    </p>
                  )}

                  {/* ── Compact meta row — score · year · duration · type ── */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 mb-3 text-[13px] sm:text-sm font-semibold text-white/70">
                    {score != null && (
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <Star className="h-3.5 w-3.5 fill-amber-400" />
                        {score}%
                      </span>
                    )}
                    {year && <span className="glass-pill text-[10px] py-0.5 px-1.5 text-white/70">{year}</span>}
                    {current.duration && <span className="glass-pill text-[10px] py-0.5 px-1.5 text-white/70">{current.duration}min</span>}
                    {current.format && (
                      <span className="glass-pill text-[10px] sm:text-[11px] uppercase tracking-wider text-white/80 py-0.5 px-1.5">
                        {current.format.replace('_', ' ')}
                      </span>
                    )}
                  </div>

                  {/* ── Genre chips ──────────────────────────────── */}
                  {current.genres.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 mb-4">
                      {current.genres.slice(0, 3).map((g) => (
                        <span key={g} className="glass-pill text-[11px] sm:text-xs py-0.5 px-2">
                          {g}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* ── 3–4 line synopsis ────────────────────────── */}
                  {current.description && (
                    <p className="text-[13px] sm:text-[15px] text-white/80 max-w-2xl line-clamp-3 md:line-clamp-4 leading-relaxed mb-6">
                      {current.description.replace(/<[^>]*>/g, '')}
                    </p>
                  )}

                  {/* ── Watch Now + More Info only ───────────────── */}
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    {current.idMal && (
                      <motion.div
                        whileHover={{ scale: 1.04, y: -2 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                      >
                        <Link
                          to={`/anime/${current.idMal}`}
                          {...preloadHandlers('/anime/x')}
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
          )}
        </div>
      </div>

      {/* ── Slide controls — anikage style ────────────────────────── */}
      {activeTab !== 'continue' && currentBackdrops.length > 1 && (
        <>
          {/* Bottom-left: progress dashes */}
          <div
            className={cn(
              'absolute left-4 sm:left-8 lg:left-14 z-20 flex items-center gap-1.5',
              upcomingEpisodes.length > 0 ? 'bottom-[72px] sm:bottom-[80px]' : 'bottom-6 sm:bottom-8',
            )}
          >
            {currentBackdrops.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onAdvance(i)}
                aria-label={`Show ${m.title.english || m.title.romaji}`}
                className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  i === currentIndex ? 'w-8 bg-white' : 'w-4 bg-white/30 hover:bg-white/55',
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
              {(currentIndex + 1).toString().padStart(2, '0')}
              <span className="text-white/35"> / </span>
              {currentBackdrops.length.toString().padStart(2, '0')}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onAdvance((currentIndex - 1 + currentBackdrops.length) % currentBackdrops.length)}
                aria-label="Previous"
                className="h-9 w-9 rounded-full border border-white/15 bg-black/60 grid place-items-center text-white/70 hover:text-white hover:bg-white/10 transition-all duration-150"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onAdvance((currentIndex + 1) % currentBackdrops.length)}
                aria-label="Next"
                className="h-9 w-9 rounded-full border border-white/15 bg-black/60 grid place-items-center text-white/70 hover:text-white hover:bg-white/10 transition-all duration-150"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Compact schedule ribbon (anidap signature) ─────────────── */}
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
                      src={item.media.coverImage.large.replace(/\/large\//, '/medium/')}
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
