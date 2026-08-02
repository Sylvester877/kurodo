import { useEffect, useState, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, Calendar, Heart, Film, Users, Globe, Hash, ArrowLeft,
  Play, Clock, Tv, ChevronRight, Bookmark, BookmarkCheck, SkipForward,
  Send, EyeOff, TrendingUp, Trophy, Share2, RefreshCw,
} from 'lucide-react'
import { getAnimeById, getAnimeRecommendations, ANIME_LOAD_STUB_TITLE } from '../api/anime'
import { getEpisodeInfoFromMal } from '../api/anilist'
import { getEpisodesByMalId, mergeJikanEpisodeMeta, type AniZipEpisode } from '../api/anizip'
import { useJikanEpisodeImages } from '../hooks/useJikanEpisodeImages'
import type { Anime } from '../types'
import { getSkipTimes, type SkipTimes } from '../api/aniskip'
import { useWatchListStore } from '../store/useWatchListStore'
import { useTitle } from '../hooks/useTitle'
import { cn, getImageUrl, getHeroImageUrl, formatScore, getBackendOrigin, withTimeout } from '../lib/utils'
import { buildEpisodeImageUrl } from '../lib/episodeImage'
import AnimeCard from '../components/AnimeCard'
import { preloadHandlers } from '../lib/routePreloaders'
import { queryClient } from '../lib/queryClient'
import { prefetchAnidapInfo, prefetchAnidapServers, prefetchStream } from '../lib/prefetch'
import { fetchAnidapInfo } from '../api/anidap'
import { useSettings } from '../store/useSettings'
import { isActivityOptedOut, setActivityOptedOut } from '../lib/sync'
import { useAuthStore } from '../store/useAuthStore'
import { Skeleton } from '../components/Skeleton'
import StaggerCard from '../components/StaggerCard'
import ScrollReveal from '../components/ScrollReveal'
import Relations from '../components/Relations'
import WatchOrder from '../components/WatchOrder'
import { fetchAnimeLogo, getTmdbLogoUrl, type TmdbLogo } from '../api/tmdb'

export default function AnimeDetails() {
  const { id } = useParams<{ id: string }>()
  const malId = id ? Number(id) : null
  const location = useLocation()

  // Hydrate from router state (passed by AnimeCard) so the details page
  // renders instantly instead of waiting on Jikan. We validate the shape
  // to avoid crashes if a list ever passes a partial object.
  const initialAnime = useMemo<Anime | undefined>(() => {
    const candidate = location.state?.anime
    if (candidate && typeof candidate === 'object' &&
        typeof candidate.mal_id === 'number' &&
        typeof candidate.title === 'string') {
      return candidate as Anime
    }
    return undefined
  }, [location.state?.anime])

  const [expanded, setExpanded] = useState(false)
  /** TMDB title logo — official PNG/SVG for the current anime */
  const [tmdbLogo, setTmdbLogo] = useState<TmdbLogo | null>(null)

  const isInWatchlist = useWatchListStore((s) => s.isInWatchlist)
  const addToWatchlist = useWatchListStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useWatchListStore((s) => s.removeFromWatchlist)
  const getLastEpisode = useWatchListStore((s) => s.getLastEpisode)


  const isSignedIn = useAuthStore((s) => !!s.auth)
  const [activityMuted, setActivityMuted] = useState(false)
  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  // ── Anidap-style compact sub-nav — appears when hero scrolls past ──
  const heroRef = useRef<HTMLDivElement>(null)
  const [subNavVisible, setSubNavVisible] = useState(false)

  // ───── React Query data layer ─────
  const animeQuery = useQuery({
    queryKey: ['anime', malId],
    // Fail fast: cap the whole fetch so a hung upstream never leaves the
    // page spinning for 20+ seconds before falling back to the stub.
    queryFn: () => withTimeout(getAnimeById(malId!), 'Anime details', 10_000),
    initialData: initialAnime ? { data: initialAnime } : undefined,
    enabled: !!malId && Number.isFinite(malId),
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })
  const anime = animeQuery.data?.data ?? null
  const isStub = anime?.title === ANIME_LOAD_STUB_TITLE
  const loading = animeQuery.isLoading

  // Defer recommendations until the bottom section scrolls into view —
  // they sit below the fold and Jikan's payload is large.
  const recsRef = useRef<HTMLDivElement>(null)
  const [loadRecs, setLoadRecs] = useState(false)
  useEffect(() => {
    const el = recsRef.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setLoadRecs(true)
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const recommendationsQuery = useQuery({
    queryKey: ['anime', malId, 'recommendations'],
    queryFn: () => withTimeout(getAnimeRecommendations(malId!), 'Recommendations'),
    enabled: !!malId && loadRecs,
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })
  const recommendations = useMemo(
    () => recommendationsQuery.data?.data?.map((x) => x.entry).slice(0, 12) ?? [],
    [recommendationsQuery.data],
  )

  const epInfoQuery = useQuery({
    queryKey: ['anime', malId, 'episodeInfo'],
    queryFn: () => withTimeout(getEpisodeInfoFromMal(malId!), 'Episode info'),
    enabled: !!malId,
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })
  const anilistId = epInfoQuery.data?.anilistId ?? null

  // Fetch episodes as soon as we have a MAL id and a Jikan episode count.
  // Don't wait for AniList epInfo — that lookup is only needed for the
  // latest-aired cap.  We fire with the total-episode cap first; when
  // epInfo lands we refetch with the stricter airedThrough cap so future
  // episodes disappear, but the list is already on screen.
  const episodesCap = epInfoQuery.data?.totalEpisodes ?? anime?.episodes ?? null
  const episodesQuery = useQuery({
    queryKey: [
      'anime', malId, 'episodes',
      episodesCap,
      epInfoQuery.data?.airedThrough ?? null,
    ],
    queryFn: () => withTimeout(getEpisodesByMalId(malId!, {
      cap: episodesCap,
      airedThrough: epInfoQuery.data?.airedThrough ?? null,
    }), 'Episodes'),
    enabled: !!malId && (anime?.episodes != null || epInfoQuery.isSuccess),
    placeholderData: (previousData) => previousData,
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })
  // Stub episode list from Jikan's total episode count: shown while AniZip
  // is still loading or if it returned nothing. This keeps the details page
  // from ever appearing empty, and every stub still links to the player.
  const stubEpisodes: AniZipEpisode[] = useMemo(() => {
    const total = anime?.episodes
    if (!total || total <= 0) return []
    return Array.from({ length: Math.min(total, 24) }, (_, i) => ({
      episode: i + 1,
      title: { en: `Episode ${i + 1}` },
    }))
  }, [anime?.episodes])

  const isLoadingEpisodes = episodesQuery.isLoading || epInfoQuery.isLoading
  // Merge real MAL screenshots (Jikan) into the AniZip list — fills the
  // thumbnail gap for long shows (Bleach: AniZip only covers eps 1–21).
  const jikanEpImages = useJikanEpisodeImages(malId, episodesQuery.isSuccess)
  const episodes: AniZipEpisode[] = useMemo(() => {
    const base = episodesQuery.data?.length ? episodesQuery.data : stubEpisodes
    return mergeJikanEpisodeMeta(base, jikanEpImages.data)
  }, [episodesQuery.data, stubEpisodes, jikanEpImages.data])

  // AniSkip probe for EP 1 — non-critical for first paint; delay briefly
  // so the initial details/episode network requests get bandwidth first.
  const [loadSkip, setLoadSkip] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setLoadSkip(true), 1500)
    return () => window.clearTimeout(t)
  }, [])

  const skipSampleQuery = useQuery({
    queryKey: ['aniskip', malId, 1],
    queryFn: () => withTimeout(getSkipTimes(malId!, 1, 0), 'Skip times'),
    enabled: !!malId && loadSkip,
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })
  const skipSample: SkipTimes | null = skipSampleQuery.data ?? null

  useTitle(anime ? (anime.title_english || anime.title) : null)

  // Scroll to top on anime change
  useEffect(() => {
    if (anime) window.scrollTo(0, 0)
  }, [anime?.mal_id])

  // Sync activity muted state once anime loads
  useEffect(() => {
    if (anime) setActivityMuted(isActivityOptedOut(anime.mal_id))
  }, [anime?.mal_id])

  // ─── Fetch TMDB title logo ───────────────────────────────────────
  useEffect(() => {
    if (!anime) return
    let cancelled = false
    // Defer the logo fetch so critical text/hero assets paint first.
    const t = window.setTimeout(() => {
      const titleEn = anime.title_english
      const titleRom = anime.title
      fetchAnimeLogo(titleEn, titleRom).then((result) => {
        if (cancelled) return
        setTmdbLogo(result?.logo ?? null)
      }).catch(() => {
        if (!cancelled) setTmdbLogo(null)
      })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [anime?.mal_id])

  // ───── Predictive pre-loading (must stay BEFORE early returns — hook order) ──
  // Pre-resolve the anidap slug + server list so the Watch page loads near-
  // instantly. The slug resolution can take 2-8 seconds on a cold cache;
  // by pre-fetching it here, Watch.tsx's slugQuery finds fresh data in the
  // React Query cache on mount and skips the 8-second timeout race entirely.
  const audioPref = useSettings((s) => s.audio)
  const serverPref = useSettings((s) => s.server)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const reduceQuality = useSettings((s) => s.reduceQuality)
  useEffect(() => {
    if (!anilistId || !malId) return
    let cancelled = false

    const runPrefetch = () => {
      if (cancelled) return
      queryClient.fetchQuery({
        queryKey: ['anidap', 'slug', anilistId],
        queryFn: () => fetchAnidapInfo(anilistId!).then((r) => r.slug ?? 'unavailable'),
        staleTime: 15 * 60 * 1000,
      }).then((slug) => {
        if (cancelled || !slug || slug === 'unavailable') return
        const ep = getLastEpisode(malId!) ?? 1
        prefetchAnidapServers(slug, ep, anilistId, {
          english: anime?.title_english,
          romaji: anime?.title,
        })
        void prefetchStream({
          malId,
          anilistId,
          anidapSlug: slug,
          nextEpisode: ep,
          audio: audioPref,
          preferredServer: serverPref,
          titles: { english: anime?.title_english, romaji: anime?.title },
        })
      }).catch(() => { /* pre-load is best-effort */ })
    }

    // Defer prefetch so it doesn't compete with the critical details/episode
    // requests during the first few seconds of the page load.
    const t = window.setTimeout(runPrefetch, 800)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [
    anilistId,
    malId,
    audioPref,
    serverPref,
    anime?.title_english,
    anime?.title,
  ])

  // ── IntersectionObserver for sticky sub-nav (must be before early returns) ──
  useEffect(() => {
    const el = heroRef.current
    if (!el || !anime) return
    const observer = new IntersectionObserver(
      ([entry]) => setSubNavVisible(!entry.isIntersecting),
      { threshold: 0, rootMargin: '-65px 0px 0px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [anime?.mal_id])

  if (loading) {
    return (
      <div className="pt-20 pb-12 mx-4">
        <div className="max-w-7xl mx-auto space-y-4">
          <Skeleton className="h-[420px]" rounded="md" />
          <div className="grid md:grid-cols-[200px_1fr] gap-6">
            <Skeleton className="hidden md:block aspect-[2/3]" />
            <div className="space-y-3">
              <Skeleton className="h-8 w-2/3" rounded="sm" />
              <div className="flex gap-2">
                <Skeleton className="h-5 w-16" rounded="sm" />
                <Skeleton className="h-5 w-16" rounded="sm" />
                <Skeleton className="h-5 w-20" rounded="sm" />
                <Skeleton className="h-5 w-16" rounded="sm" />
              </div>
              <div className="space-y-2 pt-2">
                <Skeleton className="h-3 w-full" rounded="sm" />
                <Skeleton className="h-3 w-full" rounded="sm" />
                <Skeleton className="h-3 w-4/5" rounded="sm" />
                <Skeleton className="h-3 w-3/5" rounded="sm" />
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!anime) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-md mx-auto">
          <div className="h-20 w-20 rounded-3xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-6">
            <Film className="h-10 w-10 text-muted-foreground opacity-40" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">
            {animeQuery.isError ? 'Couldn’t load anime' : 'Anime not found'}
          </h2>
          <p className="text-sm text-white/60 mb-6 leading-relaxed">
            {animeQuery.isError
              ? 'We hit a problem loading the details. This can happen when upstream APIs are slow or rate-limited.'
              : "We couldn't find this title. It may have been removed or the ID could be invalid."}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['anime', malId] })}
              className="inline-flex items-center gap-2 bg-primary hover:brightness-110 text-white px-5 py-2.5 rounded-xl font-semibold transition-all"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold border border-white/[0.08] bg-white/[0.04] text-white/80 hover:bg-white/[0.08] hover:text-white transition-all"
            >
              Go back home
            </Link>
          </div>
          {animeQuery.error && (
            <p className="mt-4 text-xs text-white/40 font-mono break-all">
              {(animeQuery.error as Error).message}
            </p>
          )}
        </div>
      </div>
    )
  }

  const inList = isInWatchlist(anime.mal_id)
  const lastEp = getLastEpisode(anime.mal_id)
  const startEp = lastEp ?? 1
  const watchHref = `/watch/${anime.mal_id}?ep=${startEp}`

  // ── Resolve the best hero backdrop: AniList banner (1920×600) → AniList extraLarge cover → Jikan trailer thumbnail
  const heroBackdrop = epInfoQuery.data?.bannerImage
    || epInfoQuery.data?.coverImageLarge
    || getHeroImageUrl(anime)
  const hasOp = !!skipSample?.op
  const hasEd = !!skipSample?.ed
  const hasSkip = hasOp || hasEd
  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }

  return (
    <motion.div
      key={anime.mal_id}
      initial={{ y: 8 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.2 }}
      className="pb-12"
    >
      {/* ──────────────────────────── Hero banner ──────────────────────────── */}
      {/* Skipped on integrated GPUs — 3 gradient overlays + mixBlendMode cause GPU memory pressure */}
      <div ref={heroRef} className="relative h-[65vh] min-h-[500px] max-h-[750px]">
        <img
          src={heroBackdrop}
          alt={anime.title}
          width={1920}
          height={600}
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover progressive-img"
          style={{ transform: reduceQuality ? 'none' : 'translate3d(0,0,0)' }}
        />
        {/* Cheap single-gradient overlay — keeps text readable without the
            GPU compositing cost of stacked blend-mode layers. */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(4,4,8,0.25) 0%, rgba(4,4,8,0.55) 40%, rgba(4,4,8,0.95) 100%)',
          }} />

        <div className="relative z-10 h-full flex flex-col justify-end max-w-[1600px] mx-auto px-4 pb-10">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-white/55 hover:text-white mb-4 transition-colors w-fit group"
          >
            <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
            Back
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex gap-6 flex-col md:flex-row md:items-end"
          >
            <motion.div
              layoutId={`poster-${anime.mal_id}`}
              className="w-36 md:w-48 shrink-0"
              style={{ transform: 'translate3d(0,0,0)' }}
            >
              <img
                src={getImageUrl(anime)} alt={anime.title}
                className="w-full rounded-xl shadow-2xl border border-white/10"
              />
            </motion.div>
            <div className="space-y-3 max-w-2xl min-h-[80px] md:min-h-[120px]">
              {/* Logo-first: TMDB PNG logo or typographic fallback.
                  The min-h on the parent prevents CLS while the logo PNG streams
                  in (or while it never loads and we fall through to the h1).
                  AnimatePresence mode="wait" makes the h1↔logo swap crossfade
                  instead of the h1 unmounting instantly. */}
              <AnimatePresence mode="wait" initial={false}>
                {tmdbLogo ? (
                  <motion.img
                    key="logo"
                    src={getTmdbLogoUrl(tmdbLogo)}
                    srcSet={`${getTmdbLogoUrl(tmdbLogo, 'w300')} 300w, ${getTmdbLogoUrl(tmdbLogo, 'w500')} 500w, ${getTmdbLogoUrl(tmdbLogo, 'original')} 1000w`}
                    sizes="(max-width: 768px) 80vw, 420px"
                    alt={anime.title_english || anime.title}
                    loading="eager"
                    fetchPriority="high"
                    decoding="async"
                    className="details-logo"
                    style={{
                      aspectRatio: `${tmdbLogo.width || 3} / ${tmdbLogo.height || 1}`,
                    }}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.1, ease: [0.23, 1, 0.32, 1] }}
                  />
                ) : (
                  <motion.h1
                    key="h1"
                    className="text-3xl md:text-5xl font-extrabold text-gradient leading-tight tracking-tight"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.1 }}
                  >
                    {anime.title_english || anime.title}
                  </motion.h1>
                )}
              </AnimatePresence>
              {/* Japanese title always shown underneath as a smaller subline —
                  useful both for original-language context and as a caption
                  underneath the branded logo image. */}
              {anime.title_japanese && (
                <p className="font-jp text-sm text-white/40 tracking-wider mt-1">
                  {anime.title_japanese}
                </p>
              )}

              {/* Badge row */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 glass-pill">
                  <Film className="h-3 w-3" />
                  {anime.type}
                </span>
                {anime.episodes && (
                  <span className="inline-flex items-center gap-1.5 glass-pill">
                    <Hash className="h-3 w-3" />
                    {anime.episodes} EP
                  </span>
                )}
                {anime.duration && (
                  <span className="inline-flex items-center gap-1.5 glass-pill">
                    <Clock className="h-3 w-3" />
                    {anime.duration.replace(' per ep', '').replace(' min', 'm')}
                  </span>
                )}
                {anime.status && (
                  <span className={cn(
                    'glass-pill font-semibold transition-all',
                    anime.status === 'Currently Airing'
                      ? 'bg-primary/15 text-primary border-primary/30 shadow-[0_0_12px_-4px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.4)]'
                      : 'bg-white/[0.04] text-white/80 border-white/[0.08]',
                  )}>
                    {anime.status === 'Currently Airing' && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary live-pulse" />
                    )}
                    {anime.status === 'Currently Airing' ? 'AIRING' : anime.status}
                  </span>
                )}
                {hasSkip && (
                  <span
                    title={[
                      hasOp && `Intro: ${fmt(skipSample!.op!.interval.startTime)}–${fmt(skipSample!.op!.interval.endTime)}`,
                      hasEd && `Outro: ${fmt(skipSample!.ed!.interval.startTime)}–${fmt(skipSample!.ed!.interval.endTime)}`,
                    ].filter(Boolean).join(' · ')}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold bg-primary/15 text-primary border border-primary/30"
                  >
                    <SkipForward className="h-3 w-3 fill-primary" />
                    Skip {hasOp && hasEd ? 'intro & outro' : hasOp ? 'intro' : 'outro'}
                  </span>
                )}
              </div>

              {/* ── Anidap-style stats row ── */}
              <div className="flex items-center gap-3 flex-wrap pt-1">
                {anime.score && (
                  <div className="flex items-center gap-2 glass-card rounded-xl px-3.5 py-2.5 border border-white/[0.06]">
                    <div className="h-8 w-8 rounded-lg bg-yellow-500/15 grid place-items-center">
                      <Star className="h-4 w-4 text-yellow-400 fill-yellow-400" />
                    </div>
                    <div className="leading-tight">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Score</p>
                      <p className="text-base font-extrabold text-white tabular-nums">{formatScore(anime.score)}</p>
                    </div>
                  </div>
                )}
                {anime.rank && (
                  <div className="flex items-center gap-2 glass-card rounded-xl px-3.5 py-2.5 border border-white/[0.06]">
                    <div className="h-8 w-8 rounded-lg bg-primary/15 grid place-items-center">
                      <Trophy className="h-4 w-4 text-primary" />
                    </div>
                    <div className="leading-tight">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Rank</p>
                      <p className="text-base font-extrabold text-white tabular-nums">#{anime.rank}</p>
                    </div>
                  </div>
                )}
                {anime.popularity && (
                  <div className="flex items-center gap-2 glass-card rounded-xl px-3.5 py-2.5 border border-white/[0.06]">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/15 grid place-items-center">
                      <TrendingUp className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div className="leading-tight">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Popularity</p>
                      <p className="text-base font-extrabold text-white tabular-nums">#{anime.popularity}</p>
                    </div>
                  </div>
                )}
                {anime.members && (
                  <div className="flex items-center gap-2 glass-card rounded-xl px-3.5 py-2.5 border border-white/[0.06]">
                    <div className="h-8 w-8 rounded-lg bg-accent/15 grid place-items-center">
                      <Users className="h-4 w-4 text-accent" />
                    </div>
                    <div className="leading-tight">
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">Members</p>
                      <p className="text-base font-extrabold text-white tabular-nums">{anime.members.toLocaleString()}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2.5 flex-wrap pt-1">
                <Link
                  to={watchHref}
                  state={{ anime }}
                  {...preloadHandlers('/watch/x')}
                  onMouseEnter={(e) => {
                    if (anilistId) prefetchAnidapInfo(anilistId)
                    e.currentTarget.style.transform = 'translate3d(0,-2px,0)'
                    e.currentTarget.style.boxShadow = '0 12px 32px -8px rgba(79,70,229,0.7)'
                  }}
                  onFocus={() => {
                    if (anilistId) prefetchAnidapInfo(anilistId)
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translate3d(0,0,0)'
                    e.currentTarget.style.boxShadow = '0 8px 24px -8px rgba(79,70,229,0.5)'
                  }}
                  className="inline-flex items-center gap-2 bg-primary hover:brightness-110 text-white px-6 py-3 rounded-2xl font-semibold transition-all"
                  style={{
                    boxShadow: '0 8px 24px -8px rgba(79,70,229,0.5)',
                    transform: 'translate3d(0,0,0)',
                  }}
                >
                  <Play className="h-5 w-5 fill-white" />
                  {lastEp ? `Resume EP ${lastEp}` : 'Watch Now'}
                </Link>

                <div className="flex items-center gap-2 rounded-2xl p-1 bg-white/[0.06] border border-white/[0.08]">
                  <button
                    onClick={() => inList ? removeFromWatchlist(anime.mal_id) : addToWatchlist(anime)}
                    className={cn(
                      'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border',
                      inList
                        ? 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                        : 'bg-white/[0.04] text-white border-white/[0.08] hover:bg-white/10 hover:border-white/20',
                    )}
                    title={inList ? 'Remove from watchlist' : 'Add to watchlist'}
                    aria-label={inList ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    {inList ? (
                      <><BookmarkCheck className="h-4 w-4 fill-red-400" /> <span className="hidden sm:inline">In list</span></>
                    ) : (
                      <><Bookmark className="h-4 w-4" /> <span className="hidden sm:inline">Add</span></>
                    )}
                  </button>

                  {/* Web Share — native share sheet (mobile + some desktop browsers) */}
                  {canShare && (
                    <button
                      onClick={() => {
                        const title = anime.title_english || anime.title
                        const url = window.location.href
                        navigator.share?.({ title, text: `Watch ${title} on Kurōdo`, url }).catch(() => {})
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border bg-white/[0.04] text-white/70 border-white/[0.08] hover:bg-white/10 hover:text-white hover:border-white/20"
                      title="Share this anime"
                      aria-label="Share this anime"
                    >
                      <Share2 className="h-4 w-4" />
                      <span className="hidden sm:inline">Share</span>
                    </button>
                  )}

                  {/* AniList activity toggle */}
                  {isSignedIn && (
                    <button
                      onClick={() => {
                        const next = !activityMuted
                        setActivityOptedOut(anime.mal_id, next)
                        setActivityMuted(next)
                      }}
                      aria-pressed={activityMuted}
                      title={
                        activityMuted
                          ? 'Episode progress is NOT posted to your AniList feed for this show. Click to re-enable.'
                          : 'Episode progress IS posted to your AniList feed for this show. Click to mute.'
                      }
                      aria-label={
                        activityMuted
                          ? 'Episode progress is NOT posted to your AniList feed for this show. Click to re-enable.'
                          : 'Episode progress IS posted to your AniList feed for this show. Click to mute.'
                      }
                      className={cn(
                        'inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border',
                        activityMuted
                          ? 'bg-white/[0.04] text-white/55 border-white/[0.08] hover:bg-white/[0.08]'
                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/15',
                      )}
                    >
                      {activityMuted ? (
                        <><EyeOff className="h-4 w-4" /> <span className="hidden sm:inline">Muted</span></>
                      ) : (
                        <><Send className="h-4 w-4" /> <span className="hidden sm:inline">Activity</span></>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Anidap-style compact sticky sub-nav ── */}
      <AnimatePresence>
        {subNavVisible && (
          <motion.div
            initial={reduceMotion ? {} : { y: -64, opacity: 0 }}
            animate={reduceMotion ? {} : { y: 0, opacity: 1 }}
            exit={reduceMotion ? {} : { y: -64, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.1, ease: [0.23, 1, 0.32, 1] }}
            className="fixed top-16 left-0 right-0 z-30 bg-black/92 border-b border-white/[0.06] shadow-md shadow-black/50"
          >
            <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center gap-3">
              {/* Mini poster */}
              <img
                src={getImageUrl(anime)}
                alt=""
                className="h-9 w-6 rounded object-cover shrink-0 border border-white/10"
              />
              {/* Title */}
              <h2 className="text-sm font-bold text-white truncate flex-1 min-w-0">
                {anime.title_english || anime.title}
              </h2>
              {/* Stats */}
              {anime.score && (
                <span className="hidden sm:inline-flex glass-pill text-yellow-400 border-yellow-500/20 bg-yellow-500/10 text-[11px] font-semibold shrink-0">
                  <Star className="h-3 w-3 fill-yellow-400" />
                  {formatScore(anime.score)}
                </span>
              )}
              {anime.rank && (
                <span className="hidden sm:inline-flex glass-pill text-primary border-primary/20 bg-primary/10 text-[11px] font-semibold shrink-0">
                  <Trophy className="h-3 w-3" />
                  #{anime.rank}
                </span>
              )}
              {/* Watch CTA */}
              <Link
                to={watchHref}
                className="shrink-0 inline-flex items-center gap-1.5 bg-primary hover:brightness-110 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition-all shadow-[0_4px_16px_-6px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.5)]"
              >
                <Play className="h-3.5 w-3.5 fill-white" />
                {lastEp ? `EP ${lastEp}` : 'Watch'}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Stub / partial-load banner ───────────────────────────────────── */}
      {isStub && (
        <div className="max-w-[1600px] mx-auto px-4 mt-6">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-amber-100 leading-relaxed">
              We couldn't load full details for this anime. Some information may be missing or out of date.
            </p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['anime', malId] })}
              className="inline-flex items-center gap-1.5 shrink-0 text-sm font-semibold text-amber-300 hover:text-amber-100 transition-colors w-fit"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        </div>
      )}

      {/* ──────────────────────────── Body ──────────────────────────── */}
      {/* Subtle section divider — anikage-style visual rhythm */}
      <div className="max-w-[1600px] mx-auto px-4">
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>

      <div className="max-w-[1600px] mx-auto px-4 mt-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-10 items-start">
        {/* Left column */}
        <div className="space-y-0 min-w-0">
          {anime.synopsis && (
            <ScrollReveal delay={0.05}>
            <section>
              <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2 mt-10">
                <span className="kicker-bar" /> Synopsis
              </h2>
              <div className="text-sm text-white/70 leading-relaxed">
                <p className={!expanded ? 'line-clamp-4' : ''}>{anime.synopsis}</p>
                {anime.synopsis.length > 240 && (
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="text-primary hover:underline mt-2 text-sm"
                  >
                    {expanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            </section>
            </ScrollReveal>
          )}

          {anime.trailer?.embed_url && (
            <ScrollReveal delay={0.1}>
            <section>
              <div className="section-divider" />
              <h2 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                <span className="kicker-bar" /> Trailer
              </h2>
              <div className="aspect-video rounded-xl overflow-hidden bg-card border border-white/10">
                <iframe
                  src={anime.trailer.embed_url}
                  className="w-full h-full"
                  allowFullScreen
                  title={`${anime.title} trailer`}
                />
              </div>
            </section>
            </ScrollReveal>
          )}

          {/* Episode quick-grid */}
          {(episodes.length > 0 || anime.episodes) && (
            <ScrollReveal delay={0.2}>
            <section>
              <div className="section-divider" />
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="kicker-bar" />
                    <h2 className="text-lg font-semibold text-white">Episodes</h2>
                    {episodes.length > 0 && !isLoadingEpisodes && (
                      <span className="text-[10px] text-muted-foreground">
                        {episodes.length} total
                      </span>
                    )}
                  </div>
                </div>
                <Link
                  to={watchHref}
                  className="group shrink-0 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 text-[12px] font-semibold text-white/60 hover:text-white hover:border-primary/30 hover:bg-primary/10 transition-all"
                >
                  Open player
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>

              {episodes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
                  {episodes.slice(0, 12).map((ep) => (
                    <Link
                      key={ep.episode}
                      to={`/watch/${anime.mal_id}?ep=${ep.episode}`}
                      state={{ anime }}
                      className="group relative flex items-center gap-3 p-2 rounded-2xl bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.05] hover:border-primary/30 transition-all duration-300 card-lift"
                    >
                      {/* Episode thumbnail */}
                      <div className="relative h-[72px] w-[120px] shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-card to-black/60 shadow-inner">
                        <img
                          src={buildEpisodeImageUrl(ep, {
                            showCover: getImageUrl(anime),
                            label: ep.episode,
                            accent: epInfoQuery.data?.accentColor,
                          })}
                          alt={`Episode ${ep.episode}`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                          onError={(e) => {
                            const img = e.currentTarget
                            const tier = Number(img.dataset.fallbackTier || '0')
                            const coverUrl = getImageUrl(anime)
                            if (!coverUrl) return
                            const accentParam = epInfoQuery.data?.accentColor ? `&accent=${encodeURIComponent(epInfoQuery.data.accentColor)}` : ''
                            const origin = getBackendOrigin()
                            if (tier === 0) {
                              // Tier 1: try the .jpg variant of the AniZip v4 URL
                              img.dataset.fallbackTier = '1'
                              const src = img.src
                              if (!/\.\w{3,4}$/.test(src)) {
                                img.src = src + '.jpg'
                                return
                              }
                            }
                            if (tier <= 1) {
                              // Tier 2: try the cover-based card with EP number
                              img.dataset.fallbackTier = '2'
                              img.src = `${origin}/img?card=1&url=${encodeURIComponent(coverUrl)}&ep=${ep.episode}${accentParam}`
                              return
                            }
                            // Tier 3: all fallbacks exhausted — fade to the gradient behind
                            img.style.opacity = '0'
                          }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                        {/* Play overlay on hover */}
                        <div className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <div className="h-8 w-8 rounded-full bg-primary/90 grid place-items-center shadow-lg backdrop-blur-sm">
                            <Play className="h-4 w-4 text-white fill-white ml-0.5" />
                          </div>
                        </div>
                        {/* Episode number badge — pill to match the Watch page episode badges */}
                        <div className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 text-[10px] font-mono font-bold text-white bg-black/80 backdrop-blur-sm px-2 py-0.5 rounded-full border border-white/10 shadow-lg">
                          EP {ep.episode}
                        </div>
                      </div>
                      {/* Episode info */}
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="text-sm font-semibold text-white/90 truncate group-hover:text-white transition-colors">
                          {ep.title?.en || ep.title?.['x-jat'] || `Episode ${ep.episode}`}
                        </p>
                        {ep.overview && (
                          <p className="text-[11px] text-white/45 line-clamp-2 mt-1.5 leading-relaxed">
                            {ep.overview}
                          </p>
                        )}
                        {ep.runtime && (
                          <p className="text-[10px] text-white/35 mt-1.5 flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {ep.runtime} min
                          </p>
                        )}
                      </div>
                    </Link>
                  ))}
                  {episodes.length > 12 && (
                    <Link
                      to={watchHref}
                      className="flex items-center justify-center gap-2 p-4 rounded-2xl bg-white/[0.02] hover:bg-white/[0.05] border border-dashed border-white/[0.1] text-sm text-white/60 hover:text-white hover:border-primary/30 transition-all sm:col-span-2 card-lift"
                    >
                      View all {anime.episodes ?? episodes.length} episodes in the player
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center">
                  <Film className="h-8 w-8 text-white/20 mx-auto mb-2" />
                  <p className="text-sm text-white/60">
                    {anime.episodes} episodes available.
                  </p>
                  <Link to={watchHref} className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2">
                    Open the player <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </section>
            </ScrollReveal>
          )}

        </div>

        {/* Right column — sticky metadata */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto custom-scrollbar lg:pr-1">
          <ScrollReveal delay={0.25}>
          <div className="glass-card rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20 grid place-items-center">
                <Calendar className="h-3.5 w-3.5 text-primary" />
              </div>
              <h3 className="font-semibold text-white">Details</h3>
            </div>
            <div className="space-y-2.5 text-sm">
              {anime.aired?.string && (
                <div className="flex items-start gap-3 py-1.5 rounded-xl bg-white/[0.02] px-3 border border-white/[0.04]">
                  <Clock className="h-4 w-4 text-white/40 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-0.5">Aired</p>
                    <p className="text-white/80">{anime.aired.string}</p>
                  </div>
                </div>
              )}
              {anime.season && anime.year && (
                <div className="flex items-start gap-3 py-1.5 rounded-xl bg-white/[0.02] px-3 border border-white/[0.04]">
                  <Globe className="h-4 w-4 text-white/40 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-0.5">Season</p>
                    <p className="text-white/80 capitalize">{anime.season} {anime.year}</p>
                  </div>
                </div>
              )}
              {anime.rating && (
                <div className="flex items-start gap-3 py-1.5 rounded-xl bg-white/[0.02] px-3 border border-white/[0.04]">
                  <Hash className="h-4 w-4 text-white/40 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-0.5">Rating</p>
                    <p className="text-white/80">{anime.rating}</p>
                  </div>
                </div>
              )}

              {anime.studios?.length > 0 && (
                <div className="flex items-start gap-3 py-1.5 rounded-xl bg-white/[0.02] px-3 border border-white/[0.04]">
                  <Tv className="h-4 w-4 text-white/40 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-0.5">Studios</p>
                    <div className="flex flex-wrap gap-1.5">
                      {anime.studios.map((s) => (
                        <Link
                          key={s.mal_id}
                          to={`/search?q=${encodeURIComponent(s.name)}`}
                          className="text-white/80 hover:text-primary transition-colors hover:underline underline-offset-4"
                        >
                          {s.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}                {anilistId && (
                <div className="pt-2 border-t border-white/5 flex items-center gap-2 text-[10px] text-white/40 font-mono">
                  <span className="glass-pill text-[10px] py-0.5 px-1.5">AniList #{anilistId}</span>
                  <span className="glass-pill text-[10px] py-0.5 px-1.5">MAL #{anime.mal_id}</span>
                </div>
              )}
            </div>
          </div>
          </ScrollReveal>

          {anime.genres?.length > 0 && (
            <ScrollReveal delay={0.3}>
            <div className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-7 w-7 rounded-lg bg-accent/10 border border-accent/20 grid place-items-center">
                  <Hash className="h-3.5 w-3.5 text-accent" />
                </div>
                <h3 className="font-semibold text-white">Genres</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {anime.genres.map((g) => (
                  <Link
                    key={g.mal_id}
                    to={`/browse?filter=genre&genreId=${g.mal_id}`}
                    className="glass-pill hover:bg-primary/15 hover:text-primary hover:border-primary/30 transition-all duration-200"
                  >
                    {g.name}
                  </Link>
                ))}
              </div>
            </div>
            </ScrollReveal>
          )}

          {anime.themes && anime.themes.length > 0 && (
            <ScrollReveal delay={0.35}>
            <div className="glass-card rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-7 w-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 grid place-items-center">
                  <Hash className="h-3.5 w-3.5 text-cyan-400" />
                </div>
                <h3 className="font-semibold text-white">Themes</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {anime.themes.map((t) => (
                  <span key={t.mal_id} className="glass-pill">
                    {t.name}
                  </span>
                ))}
              </div>
            </div>
            </ScrollReveal>
          )}

          <ScrollReveal delay={0.4}>
          <WatchOrder
            malId={anime.mal_id}
            title={anime.title_english || anime.title}
            image={getImageUrl(anime)}
            type={anime.type}
            episodes={anime.episodes}
            score={anime.score}
          />
          </ScrollReveal>

          <ScrollReveal delay={0.45}>
          <Relations anilistId={anilistId} />
          </ScrollReveal>

          {hasSkip && (
            <ScrollReveal delay={0.5}>
            <div className="glass-card rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <SkipForward className="h-4 w-4 text-primary fill-primary" />
                <h3 className="font-semibold text-white">Auto-skip available</h3>
              </div>
              <div className="space-y-2 text-xs">
                {hasOp && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                    <span className="text-white/80">Opening</span>
                    <span className="font-mono text-primary">
                      {fmt(skipSample!.op!.interval.startTime)} – {fmt(skipSample!.op!.interval.endTime)}
                    </span>
                  </div>
                )}
                {hasEd && (
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
                    <span className="text-white/80">Ending</span>
                    <span className="font-mono text-primary">
                      {fmt(skipSample!.ed!.interval.startTime)} – {fmt(skipSample!.ed!.interval.endTime)}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                Sampled from episode 1 via AniSkip · per-episode times appear in the player
              </p>
            </div>
            </ScrollReveal>
          )}

          <ScrollReveal delay={0.55}>
          <div className="glass-card rounded-xl p-4 flex items-center gap-3">
            <Heart className="h-5 w-5 text-primary" />
            <div className="text-xs text-muted-foreground leading-relaxed flex-1">
              Streams provided via third-party APIs. Quality varies by source.
            </div>
          </div>
          </ScrollReveal>
        </aside>
      </div>

      {/* Recommendations — StaggerCard children handle their own whileInView animation.
          A sentinel div lets the IntersectionObserver fire even when the
          section itself is hidden (no recommendations yet). */}
      <div ref={recsRef} className="max-w-[1600px] mx-auto px-4" />
      {recommendations.length > 0 && (
        <section className="max-w-[1600px] mx-auto px-4 mt-14">
          <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent mb-8" />
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-2">
              <span className="kicker-bar" aria-hidden />
              <h2 className="text-lg sm:text-xl font-display font-bold text-white">
                You Might Also Like
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5">
            {recommendations.map((rec, i) => (
              <StaggerCard key={rec.mal_id} index={i}>
                <AnimeCard anime={rec} />
              </StaggerCard>
            ))}
          </div>
        </section>
      )}
    </motion.div>
  )
}
