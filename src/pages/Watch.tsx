import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react'
import { useParams, Link, useSearchParams, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { motion } from 'framer-motion'
import {
  Star, Calendar, Heart, Film, Globe, Hash, ArrowLeft,
  Play, AlertCircle, Search, Keyboard, X, CheckCircle2, Eye, Mic, RefreshCw,
} from 'lucide-react'
import { useTitle } from '../hooks/useTitle'
import { getAnimeById, getAnimeRecommendations } from '../api/anime'
import { getEpisodeInfoFromMal } from '../api/anilist'
import { getEpisodesByMalId, getAniListIdFromMal, type AniZipEpisode } from '../api/anizip'
import { useAnikageEpisodes } from '../hooks/useAnikageEpisodes'
import {
  fetchAnidapInfo, fetchAnidapServers, fetchAnidapStream,
  type AnidapProvider, type AnidapStream,
} from '../api/anidap'
import { getSkipTimes, type SkipTimes } from '../api/aniskip'
import { useWatchListStore } from '../store/useWatchListStore'
import { queryClient } from '../lib/queryClient'
import { cn, getImageUrl, getHeroImageUrl, formatScore, friendlyError, safeBase64, safeSetItem, proxifyWithFallback, getBackendOrigin, withTimeout } from '../lib/utils'
import { buildEpisodeImageUrl } from '../lib/episodeImage'
import AnimeCard from '../components/AnimeCard'
import { lazyWithRetry } from '../lib/lazyWithRetry'
const VideoPlayer = lazyWithRetry(() => import('../components/VideoPlayer'))
import PlayerLoadingStages from '../components/PlayerLoadingStages'
import ServerPicker from '../components/ServerPicker'
import NextEpisodeCountdown from '../components/NextEpisodeCountdown'
import EpisodeRangePicker from '../components/EpisodeRangePicker'
import DownloadButton from '../components/DownloadButton'
import EpisodePreviewTooltip from '../components/EpisodePreviewTooltip'
import Relations from '../components/Relations'
import { toast } from '../components/Toaster'
import { pickPreferredProvider } from '../lib/providers'
import {
  prefetchSkipTimes, prefetchStream, prefetchAnidapServers,
  takePrefetchedStream, clearPrefetchedStream, cancelPrefetch,
} from '../lib/prefetch'
import { useSettings } from '../store/useSettings'
import { getFillerInfo, isFiller, type FillerInfo } from '../api/filler'
import { fetchAnimeLogo, getTmdbLogoUrl, type TmdbLogo } from '../api/tmdb'
import type { Anime } from '../types'
import SyncConfirmDialog, { useSyncConfirm } from '../components/SyncConfirmDialog'
import StarRating from '../components/StarRating'
import SleepTimerDialog from '../components/watch/SleepTimerDialog'
import KeyboardShortcutsOverlay from '../components/watch/KeyboardShortcutsOverlay'

type StreamType = 'sub' | 'dub' | 'hsub'

// Stable fallback so useMemo/useEffect deps don't churn while loading.
const EMPTY_SKIP_TIMES: SkipTimes = {}

export default function Watch() {
  const { id } = useParams<{ id: string }>()
  const malId = id ? Number(id) : null
  const [searchParams] = useSearchParams()
  const location = useLocation()

  // Hydrate from router state (passed by AnimeCard/AnimeDetails) so the
  // Watch page renders instantly instead of waiting on Jikan.
  const initialAnime = useMemo<Anime | undefined>(() => {
    const candidate = location.state?.anime
    if (candidate && typeof candidate === 'object' &&
        typeof candidate.mal_id === 'number' &&
        typeof candidate.title === 'string') {
      return candidate as Anime
    }
    return undefined
  }, [location.state?.anime])
  const epParam = Number(searchParams.get('ep')) || null
  const timeParam = Number(searchParams.get('t')) || null
  // Parse &t= to jump to a specific timestamp on load (deep link support)

  // Metadata
  const [expanded, setExpanded] = useState(false)
  const [currentEp, setCurrentEp] = useState<number>(1)
  const audio = useSettings((s) => s.audio)
  const defaultTheaterMode = useSettings((s) => s.defaultTheaterMode)
  const autoplayNext = useSettings((s) => s.autoplayNext)
  const autoplayDelay = useSettings((s) => s.autoplayDelay)
  const prefetchNext = useSettings((s) => s.prefetchNext)
  const server = useSettings((s) => s.server)
  const preferDub = useSettings((s) => s.preferDub)
  const showDubBadges = useSettings((s) => s.showDubBadges)
  const ambientMode = useSettings((s) => s.ambientMode)
  const reduceQuality = useSettings((s) => s.reduceQuality)
  const [providers, setProviders] = useState<AnidapProvider[]>([])
  const [providersUnavailable, setProvidersUnavailable] = useState(false)
  const [streamType, setStreamType] = useState<StreamType>(audio as StreamType)
  const [activeProvider, setActiveProvider] = useState<string | null>(null)
  const [stream, setStream] = useState<AnidapStream | null>(null)
  const [streamLoading, setStreamLoading] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [rateLimitSec, setRateLimitSec] = useState<number | null>(null)
  /** Tracks servers that failed for the current episode so we auto-skip them. */
  const [failedProviders, setFailedProviders] = useState<Set<string>>(new Set())
  /** Track how many auto-fallbacks we've done so we can give up eventually. */
  const fallbackCount = useRef(0)
  /** Prevent the same provider from triggering multiple onStreamError cycles. */
  const lastStreamErrorProvider = useRef<string | null>(null)

  // Memoize subtitle mapping so the array reference is stable across renders.
  // Without this, VideoPlayer's useOffsetSubtitles hook re-runs on every
  // parent render, leaking Blob URLs and flickering captions.
  const playerSubtitles = useMemo(() => {
    if (!stream?.subtitles) return []
    return stream.subtitles
      .filter((t) => t.file && (t.kind === 'captions' || t.kind === 'subtitles' || !t.kind))
      .map((t) => {
        let hSuffix = ''
        if (stream.headers && Object.keys(stream.headers).length > 0) {
          try {
            hSuffix = '&h=' + encodeURIComponent(safeBase64(JSON.stringify(stream.headers)))
          } catch {
            // safeBase64 can throw on non-ASCII headers
          }
        }
        return {
          src: `${getBackendOrigin()}/proxy?url=${encodeURIComponent(t.file)}${hSuffix}`,
          label: t.label || 'Subtitles',
          default: t.default,
          lang: t.lang || undefined,
        }
      })
  }, [stream?.subtitles, stream?.headers])

  // ═══ PERFORMANCE: atomic selectors instead of destructuring the whole
  // store. setEpisodeProgress fires every 5 s during playback — a full
  // store destructure would cause Watch.tsx + VideoPlayer to cascade-
  // re-render on every tick. Atomic selectors only fire when their
  // specific slice changes. ═══
  const isInWatchlist = useWatchListStore((s) => s.isInWatchlist)
  const addToWatchlist = useWatchListStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useWatchListStore((s) => s.removeFromWatchlist)
  const markEpisodeWatched = useWatchListStore((s) => s.markEpisodeWatched)
  const isEpisodeWatched = useWatchListStore((s) => s.isEpisodeWatched)
  const setLastWatched = useWatchListStore((s) => s.setLastWatched)
  const getLastEpisode = useWatchListStore((s) => s.getLastEpisode)
  const setEpisodeProgress = useWatchListStore((s) => s.setEpisodeProgress)
  const getEpisodeProgress = useWatchListStore((s) => s.getEpisodeProgress)
  const clearEpisodeProgress = useWatchListStore((s) => s.clearEpisodeProgress)

  // ── Sync confirmation ──
  const { show: syncDialogOpen, checkAndPrompt, handleConfirm, handleDecline: _handleDecline } = useSyncConfirm(malId, 'anime')
  const onSyncDecline = useCallback(() => {
    _handleDecline()
    if (malId) markEpisodeWatched(malId, currentEp, { skipSync: true })
  }, [_handleDecline, malId, currentEp, markEpisodeWatched])

  // Local UI state
  const [epQuery, setEpQuery] = useState('')
  const [hideWatched, setHideWatched] = useState(false)
  const [skipFiller, setSkipFiller] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('kurodo-skip-filler') !== '0'
  })
  const [showShortcuts, setShowShortcuts] = useState(false)
  useEffect(() => {
    safeSetItem('kurodo-skip-filler', skipFiller ? '1' : '0')
  }, [skipFiller])
  /** Theater mode hides the right episode-list sidebar and stretches the
   *  player to the full content width. Toggled from within the player or
   *  via the 'T' keyboard shortcut. Persisted in localStorage so the
   *  user doesn't have to re-enable on each navigation. */
  const [theaterMode, setTheaterModeState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultTheaterMode
    const ls = window.localStorage.getItem('kurodo-theater-mode')
    return ls !== null ? ls === '1' : defaultTheaterMode
  })
  const setTheaterMode = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTheaterModeState((prev) => {
      const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(prev) : v
      safeSetItem('kurodo-theater-mode', next ? '1' : '0')
      return next
    })
  }, [])
/** Start of the currently-visible episode range in the sidebar
   *  (anidap-style 1-25 / 26-50 etc.). Auto-snaps to contain currentEp.
   *  Only used when there are more than RANGE_SIZE total episodes. */
  const RANGE_SIZE = 25
  const [activeRangeStart, setActiveRangeStart] = useState<number>(1)
  const epListRef = useRef<HTMLDivElement>(null)
  const currentEpBtnRef = useRef<HTMLButtonElement>(null)
  const scrolledToCurrent = useRef(false)

  // ───── Data layer: React Query ─────
  // Anime metadata from Jikan — long staleTime since this rarely changes.
  const animeQuery = useQuery({
    queryKey: ['anime', malId],
    // Fail fast: cap the whole fetch so a hung upstream never leaves the
    // Watch page spinning for 20+ seconds (or showing a pure-black screen).
    queryFn: () => withTimeout(getAnimeById(malId!), 'Anime details', 10_000),
    initialData: initialAnime ? { data: initialAnime } : undefined,
    enabled: !!malId && Number.isFinite(malId),
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })
  const anime = animeQuery.data?.data ?? null
  const loading = animeQuery.isLoading

  // Filler detection — deferred 2.5s to prioritize critical content (hero, episodes, stream)
  const [loadFiller, setLoadFiller] = useState(false)
  useEffect(() => { const t = setTimeout(() => setLoadFiller(true), 2500); return () => clearTimeout(t) }, [malId])
  const fillerQuery = useQuery({
    queryKey: ['filler', malId],
    queryFn: () => getFillerInfo(malId!, anime?.title_english || anime?.title || ''),
    enabled: !!malId && !!anime && loadFiller,
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })
  const fillerInfo: FillerInfo | null = fillerQuery.data ?? null

  // Recommendations — deferred 1.5s, below the fold so paint first
  const [loadRecs, setLoadRecs] = useState(false)
  useEffect(() => { const t = setTimeout(() => setLoadRecs(true), 1500); return () => clearTimeout(t) }, [malId])
  const recommendationsQuery = useQuery({
    queryKey: ['anime', malId, 'recommendations'],
    queryFn: () => getAnimeRecommendations(malId!),
    enabled: !!malId && loadRecs,
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })
  const recommendations = useMemo(
    () => recommendationsQuery.data?.data?.map((x) => x.entry).slice(0, 12) ?? [],
    [recommendationsQuery.data],
  )

  // AniList episode info (id + total + airedThrough) — used to cap fake eps.
  const epInfoQuery = useQuery({
    queryKey: ['anime', malId, 'episodeInfo'],
    queryFn: () => getEpisodeInfoFromMal(malId!),
    enabled: !!malId,
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })
  // AniList id from AniList GraphQL; fallback to AniZip's MAL→AniList mapping
  // so the Watch page can still resolve streams when the AniList proxy is slow/down.
  const anizipAnilistIdQuery = useQuery({
    queryKey: ['anizip', 'anilistId', malId],
    queryFn: () => getAniListIdFromMal(malId!),
    enabled: !!malId && epInfoQuery.data?.anilistId == null,
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })
  const anilistId = epInfoQuery.data?.anilistId ?? anizipAnilistIdQuery.data ?? null
  const airedThrough = epInfoQuery.data?.airedThrough ?? null
  const totalEpisodes = epInfoQuery.data?.totalEpisodes ?? anime?.episodes ?? null
  const nextAiring = epInfoQuery.data?.nextAiring ?? null
  const aniListAccent = epInfoQuery.data?.accentColor ?? null
  /** Best available wide background image — immediate cover from router state
   *  (avoids flat gradient during loading), then upgraded to AniList banner
   *  when epInfo resolves. Priority: AniList banner > AniList coverXL > MAL trailer max > cover. */
  const heroBackground = useMemo(() => {
    const banner = epInfoQuery.data?.bannerImage
    if (banner) return banner
    const coverXl = epInfoQuery.data?.coverImageLarge
    if (coverXl) return coverXl
    if (anime) return getHeroImageUrl(anime)
    // ── NEW: use router-state cover immediately so the backdrop is never flat
    if (initialAnime) return getHeroImageUrl(initialAnime)
    return null
  }, [epInfoQuery.data?.bannerImage, epInfoQuery.data?.coverImageLarge, anime, initialAnime])

  // Episode list from AniZip.
  //
  // Cache-thrash fix: during initial load, totalEpisodes and airedThrough
  // start as null, then resolve to real values. Including null in the
  // queryKey causes React Query to fetch twice (once with the null key,
  // once with the settled key). We compute a stable cap that only updates
  // when both values are known, preventing the double fetch.
  const settledCap = useMemo(() => {
    if (totalEpisodes == null && airedThrough == null) return null
    return { cap: totalEpisodes, airedThrough }
  }, [totalEpisodes, airedThrough])

  const episodesQuery = useQuery({
    queryKey: ['anime', malId, 'episodes', settledCap],
    queryFn: () => getEpisodesByMalId(malId!, {
      cap: totalEpisodes,
      airedThrough,
    }),
    enabled: !!malId,
    staleTime: 15 * 60 * 1000,
    placeholderData: (prev) => prev,
    meta: { persist: true },
  })
  // ── Anikage-style enriched episode images: TVDB/TMDB stills for EVERY
  // episode (not just 1-21 like raw AniZip). Fetches in parallel with
  // episodesQuery; as soon as it lands we merge the real images into the
  // AniZip list. The existing buildEpisodeImageUrl already passes TMDB
  // URLs through directly — no rendering changes needed.
  const anikageEpQuery = useAnikageEpisodes(malId, episodesQuery.isSuccess)
  const episodes: AniZipEpisode[] = useMemo(() => {
    const base = episodesQuery.data ?? []
    const anikageMap = new Map(anikageEpQuery.data?.episodes?.map(e => [e.number, e]) ?? [])
    if (anikageMap.size === 0) return base
    return base.map(ep => {
      const enriched = anikageMap.get(Number(ep.episode))
      if (enriched?.image && !enriched.image.includes('cdn.anidb.net')) {
        return { ...ep, image: enriched.image }
      }
      return ep
    })
  }, [episodesQuery.data, anikageEpQuery.data])

  // ── Memoize episode filtering so we don't re-compute on every render.
  // Critical for 100+ ep anime (One Piece etc.) where re-filtering the
  // entire array on every keystroke / render causes visible jank.
  const filteredEpisodes = useMemo(() => {
    if (!anime) return []
    return episodes
      .filter((ep) => {
        if (epQuery.trim()) {
          const q = epQuery.toLowerCase().trim()
          const num = String(ep.episode)
          const title =
            (ep.title?.en || ep.title?.['x-jat'] || '').toLowerCase()
          return num.includes(q) || title.includes(q)
        }
        if (episodes.length <= RANGE_SIZE) return true
        const rangeEnd = activeRangeStart + RANGE_SIZE - 1
        return ep.episode >= activeRangeStart && ep.episode <= rangeEnd
      })
      .filter((ep) => {
        if (!hideWatched) return true
        return ep.episode === currentEp || !isEpisodeWatched(anime.mal_id, ep.episode)
      })
  }, [episodes, epQuery, activeRangeStart, hideWatched, currentEp, anime,
      isEpisodeWatched, RANGE_SIZE])

  // ── Episode sidebar virtualization (100+ eps only). Each row ~84px. ──
  const EP_ROW_HEIGHT = 84
  const shouldVirtualize = episodes.length > 100 && filteredEpisodes.length > 0
  const episodeVirtualizer = useVirtualizer({
    count: shouldVirtualize ? filteredEpisodes.length : 0,
    getScrollElement: useCallback(() => epListRef.current, []),
    estimateSize: useCallback(() => EP_ROW_HEIGHT, []),
    overscan: 5,
  })

  // Auto-scroll to the current episode button once the episode list loads.
  // MUST sit below `episodes` — referencing it before declaration is a TDZ crash.
  // Reset the flag when currentEp changes so the sidebar re-positions.
  useEffect(() => {
    scrolledToCurrent.current = false
  }, [currentEp])
  useEffect(() => {
    if (scrolledToCurrent.current || episodes.length === 0) return
    if (shouldVirtualize) {
      const idx = filteredEpisodes.findIndex((e) => e.episode === currentEp)
      if (idx >= 0) {
        requestAnimationFrame(() => {
          episodeVirtualizer.scrollToIndex(idx, { align: 'center' })
          scrolledToCurrent.current = true
        })
      }
    } else if (currentEpBtnRef.current) {
      currentEpBtnRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      scrolledToCurrent.current = true
    }
  }, [episodes.length, currentEp, shouldVirtualize, episodeVirtualizer])

  // Anidap slug resolution — patient 25s timeout so slow upstreams
  // (cold Puppeteer, rate-limit backoff) don't trip the UI into
  // "No stream source found". Falls back to the numeric anilistId as the
  // slug, which the router already accepts and resolves correctly.
  const slugQuery = useQuery({
    queryKey: ['anidap', 'slug', anilistId],
    enabled: anilistId != null,
    staleTime: 15 * 60 * 1000,
    queryFn: async (): Promise<string | 'unavailable'> => {
      if (!anilistId) return 'unavailable'
      const ctrl = new AbortController()
      const timeout = new Promise<{ slug: null }>((resolve) =>
        window.setTimeout(() => {
          ctrl.abort()
          resolve({ slug: null })
        }, 25000),
      )
      try {
        const res = await Promise.race([fetchAnidapInfo(anilistId, ctrl.signal), timeout])
        // If the backend is slow or returns no slug, fall back to the
        // numeric id as a slug. The router accepts numeric slugs and
        // resolves streams via anilistId, so this keeps the page usable
        // instead of showing "No stream source found".
        if (!res || res.slug == null) {
          console.warn('[Watch] slug resolution fallback, using numeric id:', anilistId)
          return String(anilistId)
        }
        return res.slug
      } catch (e: any) {
        if (e?.name === 'AbortError') return String(anilistId)
        return String(anilistId)
      }
    },
  })
  // 'pending' while we haven't even tried yet, otherwise the resolved value.
  const anidapSlug: 'pending' | 'unavailable' | string = (() => {
    // Wait for either AniList or AniZip mapping to settle.
    // Only wait for the AniZip fallback if it is enabled (i.e. AniList id unknown).
    const mappingLoading = epInfoQuery.isLoading ||
      (anizipAnilistIdQuery.isLoading && anizipAnilistIdQuery.fetchStatus !== 'idle')
    if (mappingLoading) return 'pending'
    if (!anilistId) return 'unavailable'

    if (slugQuery.isLoading || slugQuery.isFetching) return 'pending'
    return slugQuery.data ?? 'pending'
  })()

  // Skip times for the current episode (AniSkip).
  const skipQuery = useQuery({
    queryKey: ['aniskip', malId, currentEp],
    queryFn: () => getSkipTimes(malId!, currentEp, 0),
    enabled: !!malId && currentEp > 0,
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })
  const skipTimesFromApi: SkipTimes = skipQuery.data ?? EMPTY_SKIP_TIMES
  // Blend in chad's per-stream chapters. AniSkip is more accurate (community
  // submitted) so it wins for op/ed; chad fills gaps when AniSkip has nothing.
  const skipTimes: SkipTimes = useMemo(() => {
    const out: SkipTimes = { ...skipTimesFromApi }
    const chapters = stream?.chapters ?? []
    for (const ch of chapters) {
      const t = (ch.title || '').toLowerCase()
      const fauxSkip = {
        interval: { startTime: ch.start, endTime: ch.end },
        skipType: t.includes('intro') ? 'op' : t.includes('outro') || t.includes('ending') ? 'ed' : 'recap',
        skipId: `chad-${t}`,
        episodeLength: 0,
      } as SkipTimes['op']
      if (!fauxSkip) continue
      if (t.includes('intro') && !out.op) out.op = fauxSkip
      else if ((t.includes('outro') || t.includes('ending')) && !out.ed) out.ed = fauxSkip
    }
    return out
  }, [skipTimesFromApi, stream?.chapters])

  // Side-effects derived from queries:
  //   - set the document title once the anime resolves
  //   - reset currentEp on first load (from ?ep=, then continue-watching, then 1)
  //   - scroll to top + toast when skip data lands
  useTitle(anime ? (anime.title_english || anime.title) : null)

  useEffect(() => {
    if (!anime || !malId) return
    window.scrollTo(0, 0)
    const lastEp = getLastEpisode(malId)
    setCurrentEp(Number(epParam ?? lastEp ?? 1) || 1)
    // Reset on anime identity change only — anime.mal_id is the stable key.
    // Adding getLastEpisode or setCurrentEp as deps would create a chain
    // of re-renders when the user manually changes episodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anime?.mal_id])

  useEffect(() => {
    if (!skipQuery.isSuccess) return
    const t = skipQuery.data
    const segs: string[] = []
    // Fire a toast when the skip-times response lands. Using
    // skipQuery.dataUpdatedAt as the signal avoids re-toasting when
    // the data content is identical (e.g. on refetch).
    if (t?.op) segs.push('intro')
    if (t?.ed) segs.push('outro')
    if (segs.length > 0) {
      toast.info(`Skip ${segs.join(' & ')} available for this episode`, 2500)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipQuery.dataUpdatedAt])

  // Record "continue watching" + keep ?ep= URL in sync
  useEffect(() => {
    if (!anime || !currentEp) return
    setLastWatched(anime, currentEp)

    // Update the URL without forcing a React Router state update/re-render
    const url = new URL(window.location.href)
    if (Number(url.searchParams.get('ep')) !== currentEp) {
      url.searchParams.set('ep', String(currentEp))
      window.history.replaceState(null, '', url.pathname + url.search)
    }
    // Keep ?ep= in the URL bar without a full React Router navigation.
    // Only the identity keys (mal_id, currentEp) matter — adding
    // setLastWatched, anime, or window.history would cause loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anime?.mal_id, currentEp])

  // ───── Autoplay next ─────
  // When the player fires onNearEnd, start a countdown the user can cancel.
  // Length comes from autoplayDelay; if autoplayNext is off, nothing
  // happens (the user can still click "Next ep" in the sidebar).
  //
  // currentEpRef prevents the stale closure in the autoplay countdown
  // effect: if the user manually changes episodes during the countdown,
  // goToNextEpisode still advances from the *current* episode.
  const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null)
  const currentEpRef = useRef(currentEp)
  currentEpRef.current = currentEp
  const autoplayCountdownRef = useRef(autoplayCountdown)
  autoplayCountdownRef.current = autoplayCountdown
  // Guard against rapid double-firing of the autoplay next action.
  const isNavigatingRef = useRef(false)
  const goToNextEpisode = useCallback(() => {
    if (isNavigatingRef.current) return
    isNavigatingRef.current = true
    const total = totalEpisodes || anime?.episodes || episodes.length || 0
    let next = Number(currentEpRef.current) + 1
    // Skip filler episodes if enabled — but only ONE at a time.
    // A while-loop would skip entire filler arcs (Naruto ep 25→98),
    // breaking the binge experience. Users can click Next again to skip
    // the next filler too; auto-advance only skips the immediate filler.
    if (skipFiller && fillerInfo && next <= total && isFiller(next, fillerInfo)) {
      next++
    }
    if (total && next <= total) setCurrentEp(next)
    setAutoplayCountdown(null)
  }, [totalEpisodes, anime?.episodes, episodes.length, skipFiller, fillerInfo])

  // Reset navigation guard whenever the active episode changes.
  useEffect(() => {
    isNavigatingRef.current = false
  }, [currentEp])
  const onPlayerNearEnd = useCallback(() => {
    if (!autoplayNext) return
    const total = episodes.length || anime?.episodes || 0
    if (!total || currentEp >= total) return
    // Use functional update so we don't need 'autoplayCountdown' in deps.
    // This avoids re-creating this callback every second while the
    // countdown ticks, which would re-run VideoPlayer's useEffect.
    // Also use a ref guard to avoid scheduling work when a countdown is
    // already running.
    if (autoplayCountdownRef.current != null) return
    setAutoplayCountdown(autoplayDelay)
  }, [autoplayNext, autoplayDelay, episodes.length, anime?.episodes, currentEp])

  // ───── Episode prefetch ─────
  // Player calls this at every 10% milestone. We use 0.5 / 0.7 / 0.75 to start
  // warming the next episode's data so autoplay feels instant.
  const onPlayerProgress = useCallback((pct: number) => {
    if (!prefetchNext || !malId) return
    const total = episodes.length || anime?.episodes || 0
    const nextEp = currentEp + 1
    if (!total || nextEp > total) return

    if (pct === 0.5) {
      // Warm skip-times + server list early so both are cached before
      // the user clicks "next episode" or autoplay fires.
      prefetchSkipTimes(malId, nextEp)
      if (anidapSlug !== 'pending' && anidapSlug !== 'unavailable') {
        prefetchAnidapServers(anidapSlug, nextEp, anilistId, {
          english: anime?.title_english,
          romaji: anime?.title,
        })
      }
    } else if (pct === 0.7 &&
               anidapSlug !== 'pending' &&
               anidapSlug !== 'unavailable') {
      // Expensive: prefetch the actual decrypted stream URL.
      void prefetchStream({
        malId,
        anilistId,
        anidapSlug,
        nextEpisode: nextEp,
        audio: streamType,
        preferredServer: server,
        titles: { english: anime?.title_english, romaji: anime?.title },
      })
    } else if (pct === 0.75 &&
               anidapSlug !== 'pending' &&
               anidapSlug !== 'unavailable') {
      // Redundant safety net: re-trigger if 70% was missed or aborted
      void prefetchStream({
        malId,
        anilistId,
        anidapSlug,
        nextEpisode: nextEp,
        audio: streamType,
        preferredServer: server,
        titles: { english: anime?.title_english, romaji: anime?.title },
      })
    }
  }, [
    prefetchNext, server, malId, anilistId, anidapSlug,
    episodes.length, anime?.episodes, currentEp, streamType,
  ])

  // ── Auto-mark episode as watched when video ends and sync to AniList ──
  const inList = anime ? isInWatchlist(anime.mal_id) : false

  // ── CRITICAL: must be memoized so VideoPlayer's progress effect doesn't
  // re-run on every render, which triggers save() in cleanup, which calls
  // this callback, which updates Zustand, which re-renders Watch.tsx… loop.
  const onVideoEnded = useCallback(() => {
    if (!malId || !anime) return
    // Don't auto-mark if already watched (toggle behavior)
    if (isEpisodeWatched(anime.mal_id, currentEp)) return
    // Add to watchlist if not already there (needed for AniList sync)
    if (!inList) addToWatchlist(anime)
    markEpisodeWatched(anime.mal_id, currentEp)
    toast.success(`✓ EP ${currentEp} marked as watched`, 2000)
  }, [malId, anime, currentEp, inList, isEpisodeWatched, addToWatchlist, markEpisodeWatched])

  // ── CRITICAL: must be memoized so VideoPlayer's progress effect doesn't
  // re-run on every render, which triggers save() in cleanup, which calls
  // this callback, which updates Zustand, which re-renders Watch.tsx… loop.
  const onProgressTick = useCallback((time: number, duration: number) => {
    if (!malId) return
    // Auto-clear when very close to the end so we don't pop
    // a resume banner for an episode the user just finished.
    if (duration > 0 && time >= duration - 30) {
      clearEpisodeProgress(malId, currentEp)
    } else {
      setEpisodeProgress(malId, currentEp, time, duration)
    }
  }, [malId, currentEp, clearEpisodeProgress, setEpisodeProgress])

  // Cancel any in-flight prefetch if the user manually jumps episodes.
  useEffect(() => {
    return () => cancelPrefetch()
  }, [currentEp])

  // Lightweight prefetch: as soon as we know the slug + current episode,
  // warm the NEXT episode's server list. Saves ~1-2s when the user clicks
  // "next episode" (vs waiting for the network round-trip on click).
  // This is cheap (one HTTP request) so we do it unconditionally rather
  // than gating on prefetchNext.
  useEffect(() => {
    if (anidapSlug === 'pending' || anidapSlug === 'unavailable') return
    const total = episodes.length || anime?.episodes || 0
    const nextEp = currentEp + 1
    if (total && nextEp <= total) {
      prefetchAnidapServers(anidapSlug, nextEp, anilistId, {
        english: anime?.title_english,
        romaji: anime?.title,
      })
    }
  }, [anidapSlug, currentEp, episodes.length, anime?.episodes, anilistId])

  // Tick the autoplay countdown once per second; jump to next ep when it hits 0.
  useEffect(() => {
    if (autoplayCountdown == null) return
    if (autoplayCountdown <= 0) {
      goToNextEpisode()
      return
    }
    const t = window.setTimeout(() => {
      setAutoplayCountdown((c) => (c == null ? null : c - 1))
    }, 1000)
    return () => window.clearTimeout(t)
  }, [autoplayCountdown, goToNextEpisode])

  // Reset failed providers when episode, type, or slug changes
  useEffect(() => {
    setFailedProviders(new Set())
    fallbackCount.current = 0
    lastStreamErrorProvider.current = null
  }, [currentEp, streamType, anidapSlug])

  // ---- When episode or slug changes, load providers ----
  // Bumping `serverReloadKey` re-runs this effect — used by the Retry button.
  const [serverReloadKey, setServerReloadKey] = useState(0)
  const retryTimerRef = useRef<number | null>(null)
  // Clean up the Retry button's setTimeout on unmount to prevent
  // setState-on-unmounted-component warnings and stale provider flips.
  useEffect(() => () => { if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current) }, [])
  useEffect(() => {
    if (anidapSlug === 'pending' || anidapSlug === 'unavailable') {
      setProviders([])
      return
    }
    let cancelled = false
    setStreamError(null)
    fetchAnidapServers(anidapSlug, currentEp, anilistId, undefined, {
      english: anime?.title_english,
      romaji: anime?.title,
    })
      .then(({ providers: list, unavailable }) => {
        if (cancelled) return
        setProviders(list)
        setProvidersUnavailable(!!unavailable)
        // Prefer the current stream type, prefer user's audio setting.
        // If user has preferDub enabled and dub providers exist, auto-select dub.
         const hasDub = list.some((p) => p.type === 'dub')
        const hasSub = list.some((p) => p.type === 'sub')
        let targetType = streamType
        if (preferDub && hasDub) targetType = 'dub'
        else if (!hasSub && hasDub) targetType = 'dub'
        else if (!hasDub && !hasSub && list.length > 0) targetType = list[0].type as StreamType
        else if (!hasDub && targetType === 'dub') targetType = 'sub' // fallback to sub when no dub available
        const sameType = list.filter((p) => p.type === targetType)
        const pick = pickPreferredProvider(sameType, server)
          ?? pickPreferredProvider(list, server)
        if (pick) {
          setActiveProvider(pick.name)
          setStreamType(pick.type as StreamType)
        } else {
          setActiveProvider(null)
        }
      })
      .catch((e) => !cancelled && setStreamError(friendlyError(e)))
    // Server reload key + identity params are the only true triggers.
    // Adding streamType, server as deps would re-fetch on
    // every server-preference change during page load.
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anidapSlug, currentEp, anilistId, serverReloadKey])

  // Poll /api/health for rate-limit countdown when providers are unavailable.
  // Auto-retries when the cooldown expires so the user doesn't have to guess.
  useEffect(() => {
    if (!providersUnavailable || rateLimitSec === 0) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${getBackendOrigin()}/api/health`)
        const json = await res.json()
        const remaining = json?.data?.rateLimitRemaining ?? 0
        setRateLimitSec(remaining > 0 ? remaining : null)
        if (remaining <= 0 && providersUnavailable) {
          setProvidersUnavailable(false)
          setServerReloadKey((k) => k + 1)
        }
      } catch { /* health endpoint may be busy */ }
    }, 10000)
    // Initial fetch
    fetch(`${getBackendOrigin()}/api/health`).then(r => r.json()).then(j => {
      const remaining = j?.data?.rateLimitRemaining ?? 0
      setRateLimitSec(remaining > 0 ? remaining : null)
    }).catch(() => {})
    return () => clearInterval(interval)
  }, [providersUnavailable, rateLimitSec])
  // Fast path: if we prefetched this episode while watching the previous one,
  // use it immediately and skip the decryption round-trip.
  useEffect(() => {
    if (anidapSlug === 'pending' || anidapSlug === 'unavailable' || !activeProvider || !malId) {
      setStream(null)
      return
    }
    let cancelled = false

    // Check the prefetch cache first.
    const prefetched = takePrefetchedStream(malId, currentEp, streamType, activeProvider)
    if (prefetched) {
      setStreamError(null)
      setStream(prefetched.stream)
      setStreamLoading(false)
      clearPrefetchedStream(malId, currentEp)
      return
    }

    setStreamLoading(true)
    setStreamError(null)
    setStream(null)
    void (async function tryGetStream(providerName: string, attemptNum: number) {
      // Safety valve: don't loop forever. Max 10 attempts per episode.
      if (attemptNum > 10) {
        setStreamLoading(false)
        setStreamError('All servers exhausted after 10 attempts — try again later.')
        toast.error('All servers exhausted for this episode.')
        return
      }

      try {
        // Look up the provider object for the CURRENT provider being tried
        const curPObj = providers.find((p) => p.name === providerName && p.type === streamType)
        const data = await fetchAnidapStream(anidapSlug, currentEp, providerName, streamType, {
          anilistId,
          forceSource: curPObj?._provider,
          titles: { english: anime?.title_english, romaji: anime?.title },
        })
        if (cancelled) return
        setStream(data)
        setStreamLoading(false)
        setFailedProviders(new Set())  // reset on success
        fallbackCount.current = 0
      } catch (e) {
        if (cancelled) return

        // Track this provider as failed
        const newFailed = new Set(failedProviders)
        newFailed.add(providerName)
        setFailedProviders(newFailed)

        // Find next available provider of the same type
        const sameType = (providersByType[streamType] ?? []).filter(
          (p) => !newFailed.has(p.name),
        )

        if (sameType.length > 0) {
          const nextProvider = sameType[0]
          const cleanFailed = providerName.replace(/^anidap-/, '')
          const cleanNext = nextProvider.name.replace(/^anidap-/, '')
          toast.info(`${cleanFailed} failed — auto-switching to ${cleanNext}…`, 3000)
          fallbackCount.current = attemptNum
          // Trigger next attempt via state update (separate from setFailedProviders)
          setActiveProvider(nextProvider.name)
        } else {
          // All servers exhausted for this type
          setStreamLoading(false)
          setStreamError(friendlyError(e))
          toast.error(`All ${streamType.toUpperCase()} servers exhausted — try another audio type.`)
        }
      }
    })(activeProvider, fallbackCount.current + 1)
    return () => { cancelled = true }
  }, [anidapSlug, currentEp, activeProvider, streamType, malId, anilistId])

  // TMDB title logo — branded PNG for the current anime. Fetched once per
  // anime (cached in tmdb.ts for 24h). Null while loading or if no logo
  // exists for this title on TMDB.
  const [tmdbLogo, setTmdbLogo] = useState<TmdbLogo | null>(null)
  useEffect(() => {
    if (!anime) return
    let cancelled = false
    setTmdbLogo(null) // clear stale logo while we fetch the new one
    fetchAnimeLogo(anime.title_english, anime.title).then((result) => {
      if (!cancelled) setTmdbLogo(result?.logo ?? null)
    })
    return () => { cancelled = true }
    // Re-run when the English title arrives late — Jikan often returns
    // the basic title first and the English title in a follow-up response.
  }, [anime?.mal_id, anime?.title_english])

  // Group providers by type for the selector chips
  const providersByType = useMemo(() => {
    const g: Record<string, AnidapProvider[]> = { sub: [], dub: [], hsub: [] }
    for (const p of providers) {
      (g[p.type] ||= []).push(p)
    }
    return g
  }, [providers])

  // Quick dub/sub toggle — shows when both types are available
  const hasDubAvailable = providersByType.dub.length > 0
  const hasSubAvailable = providersByType.sub.length > 0
  const hasHsubAvailable = providersByType.hsub.length > 0
  const canToggleAudio = (hasDubAvailable && hasSubAvailable) || hasHsubAvailable

  const currentEpisodeMeta = episodes.find((e) => e.episode === currentEp)

  // Detect final episode so we can prompt for a rating below the player.
  const isLastEpisode = useMemo(() => {
    const total = totalEpisodes || anime?.episodes || episodes.length || 0
    return total > 0 && currentEp === total
  }, [totalEpisodes, anime?.episodes, episodes.length, currentEp])

  // Auto-snap the range picker to whatever range contains currentEp
  // (so jumping forward/back puts the right page on screen).
  useEffect(() => {
    if (!currentEp) return
    const containingStart = Math.floor((currentEp - 1) / RANGE_SIZE) * RANGE_SIZE + 1
    if (containingStart !== activeRangeStart) setActiveRangeStart(containingStart)
    // We intentionally don't depend on activeRangeStart to avoid loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEp])

  // ───── Sleep Timer ─────
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null)
  const [sleepActive, setSleepActive] = useState(false)
  const [sleepDialogOpen, setSleepDialogOpen] = useState(false)

  useEffect(() => {
    if (!sleepActive || !sleepMinutes) return
    const id = window.setTimeout(() => {
      // Pause video and show toast
      const video = document.querySelector('video')
      video?.pause()
      toast.info('Sleep timer ended — playback paused')
      setSleepActive(false)
    }, sleepMinutes * 60 * 1000)
    return () => window.clearTimeout(id)
  }, [sleepActive, sleepMinutes])

  if (loading) {
    // ── Cinematic loading backdrop: when we have router-state data,
    // show a blurred cover instead of a flat gradient. Falls back to
    // the branded gradient when no initial data is available (e.g.
    // cold page load with no card click).
    const loadingCover = initialAnime ? getHeroImageUrl(initialAnime) : null
    return (
      <div className="relative min-h-screen">
        {/* Cinematic blurred cover backdrop when available — much more
            aesthetic than the old flat gradient + skeleton blocks */}
        {loadingCover ? (
          <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
            <img
              src={proxifyWithFallback(loadingCover)}
              alt=""
              aria-hidden
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'blur(8px) saturate(1.1) brightness(0.45)' }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(180deg, hsl(0,0%,4%) 0%, hsla(0,0%,4%,0.8) 50%, hsl(0,0%,3%) 100%)',
              }}
            />
          </div>
        ) : (
          <div className="pointer-events-none fixed inset-0 -z-10"
            style={{ background: 'linear-gradient(180deg, hsl(245,16%,8%) 0%, hsl(245,10%,5%) 40%, hsl(0,0%,3%) 100%)' }} />
        )}
        <div className="pt-20 pb-12 mx-4">
          <div className="animate-pulse max-w-7xl mx-auto">
            <div className="h-[400px] bg-card rounded-2xl mb-8" />
            <div className="h-8 w-2/3 bg-card rounded-xl mb-4" />
            <div className="flex gap-2">
              <div className="h-5 w-16 bg-card rounded-md" />
              <div className="h-5 w-20 bg-card rounded-md" />
              <div className="h-5 w-16 bg-card rounded-md" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!anime) {
    return (
      <div className="pt-20 pb-12 mx-4 text-center min-h-[60vh] flex flex-col items-center justify-center">
        <div className="h-20 w-20 rounded-3xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mx-auto mb-6">
          <Film className="h-10 w-10 text-muted-foreground opacity-40" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">
          {animeQuery.isError ? 'Couldn’t load anime' : 'Anime not found'}
        </h2>
        <p className="text-sm text-white/60 mb-6 leading-relaxed max-w-md">
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
          <p className="mt-4 text-xs text-white/40 font-mono break-all max-w-md">
            {(animeQuery.error as Error).message}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="pb-12 pt-20 relative">
      {/* ═══════════════════════════════════════════════════════════════
          CINEMATIC HERO BANNER — per-anime wide background image with
          layered gradient overlays for readability. AniList banner
          (1920×600) preferred; falls back to MAL trailer max → cover.
          The accent colour tint ties the banner to the show's palette.
          ════════════════════════════════════════════════════════════ */}
      {/* ── Watch page background — always renders so the page never goes black.
           When heroBackground is available AND reduceQuality is off, we show the
           cinematic banner with gradient overlays. Otherwise we fall back to a
           subtle brand-colour gradient that matches the app's dark aesthetic.
           Previously this block was gated behind `heroBackground && !reduceQuality`,
           which left the page transparent (showing the near-black body background)
           when the image hadn't loaded yet OR when iGPU mode was active. */}
      <div key={malId ?? 'watch-bg'} aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {heroBackground && !reduceQuality ? (
          <>
            <img
              key={heroBackground}
              src={proxifyWithFallback(heroBackground)}
              alt=""
              width={1920}
              height={1080}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: 'blur(1px) saturate(1.2) brightness(0.55)' }}
            />

            {/* Layer 1 — accent colour radial glow */}
            <div
              className="absolute inset-0"
              style={{
                background: aniListAccent
                  ? `radial-gradient(ellipse 70% 80% at 50% 0%, ${aniListAccent}33, transparent 70%)`
                  : 'radial-gradient(ellipse 70% 80% at 50% 0%, hsla(245,75%,35%,0.2), transparent 70%)',
                opacity: 0.7,
              }}
            />

            {/* Layer 2 — bottom-to-top deep fade for content readability */}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(180deg, hsl(0,0%,4%) 0%, hsla(0,0%,4%,0.85) 25%, hsla(0,0%,4%,0.65) 50%, hsla(0,0%,4%,0.4) 100%)',
              }}
            />

            {/* Layer 3 — subtle vignette */}
            <div
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse 50% 50% at 50% 50%, transparent 40%, hsla(0,0%,4%,0.5) 100%)',
              }}
            />
          </>
        ) : (
          /* Fallback gradient — branded dark with a subtle radial accent glow.
             Visible when reduceQuality is on (iGPU), or while the hero image
             is still loading. Prevents the page from going flat black. */
          <>
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(180deg, hsl(245,16%,8%) 0%, hsl(245,10%,5%) 40%, hsl(0,0%,3%) 100%)',
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse 70% 80% at 50% 0%, hsla(245,75%,35%,0.15), transparent 60%)',
                opacity: 0.6,
              }}
            />
          </>
        )}
      </div>

      {/* Compact top bar — back link only. */}
      <div className="max-w-[1600px] mx-auto px-4 mb-3">
        <Link
          to={`/anime/${anime.mal_id}`}
          className="inline-flex items-center gap-1.5 text-xs text-white/55 hover:text-white transition-colors group"
        >
          <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
          Back to details
        </Link>
      </div>

      {/*
        Wider split grid (1600px max) with the player taking ~70% on desktop.
        Episode list rail sits beside the player so you can binge without
        scrolling — anidap/Crunchyroll style.
      */}
      <div
        className={cn(
          'mx-auto px-4 grid grid-cols-1 gap-4 items-start relative z-[1] transition-[max-width,grid-template-columns] duration-300',
          theaterMode
            ? 'max-w-[1800px]'
            : 'max-w-[1600px] lg:grid-cols-[minmax(0,1fr)_380px]',
        )}
      >
        {/* Ambient backdrop glow — soft, blurred copy of the episode thumb
            behind the whole watch column. Anidap-style "vibey" feel. */}
        {ambientMode && getImageUrl(anime) && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 opacity-30 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
            style={{
              backgroundImage: `url('${getImageUrl(anime)}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'center top',
              filter: 'blur(24px) saturate(1.1)',
            }}
          />
        )}

        {/* ---- Player + episode info ---- */}
        <div className="space-y-4 min-w-0">
          {/* Player */}
          {anidapSlug === 'pending' ? (
            <div className="aspect-video w-full rounded-xl bg-gradient-to-b from-zinc-900 via-zinc-900/90 to-black/70 grid place-items-center overflow-hidden relative border border-white/10">
              {getImageUrl(anime) && (
                <img
                  src={getImageUrl(anime)}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover opacity-30"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
              <div className="relative flex flex-col items-center gap-4">
                <div className="h-10 w-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <PlayerLoadingStages stage="resolving" detail="Connecting to source server…" />
                <Link
                  to={`/anime/${anime.mal_id}`}
                  className="px-3 py-1.5 rounded-lg glass text-white/70 text-xs font-semibold hover:bg-white/10 transition-colors"
                >
                  ← Back to details
                </Link>
              </div>
            </div>
          ) : anidapSlug === 'unavailable' ? (
            <div className="aspect-video w-full rounded-xl bg-card flex flex-col items-center justify-center text-center p-6 gap-3">
              <div className="max-w-md">
                <AlertCircle className="h-10 w-10 text-yellow-400 mx-auto mb-3" />
                <p className="text-sm text-white/80 font-semibold mb-1">
                  No stream source found
                </p>
                <p className="text-xs text-muted-foreground mb-1">
                  {rateLimitSec != null && rateLimitSec > 0
                    ? 'Anidap is rate-limited — we\'ll retry automatically when the cooldown expires.'
                    : 'This title isn\'t available on our streaming sources yet. The scraper only supports titles hosted on anidap.'}
                </p>
                <p className="text-[10px] text-muted-foreground mb-4">
                  You can still browse the details, watch trailers, and track this in your watchlist.
                </p>
                {rateLimitSec != null && rateLimitSec > 0 ? (
                  <div className="mb-4">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                      <span className="text-[11px] font-semibold text-amber-300">
                        Rate-limited · retry in {Math.ceil(rateLimitSec / 60)} min {rateLimitSec % 60}s
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Auto-retrying when cooldown expires…
                    </p>
                  </div>
                ) : null}
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <Link
                    to={`/anime/${anime.mal_id}`}
                    className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
                  >
                    View details & trailers
                  </Link>
                  <Link
                    to="/browse"
                    className="px-4 py-1.5 rounded-lg glass text-white/80 text-xs font-semibold hover:bg-white/10 transition-colors"
                  >
                    Browse trending
                  </Link>
                </div>
              </div>
            </div>
          ) : streamLoading || !stream ? (
            <div className="aspect-video w-full rounded-xl bg-gradient-to-b from-zinc-900 via-zinc-900/90 to-black/70 grid place-items-center overflow-hidden relative border border-white/10">
              {getImageUrl(anime) && (
                <img
                  src={getImageUrl(anime)}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full object-cover opacity-40"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/30" />
              <Link
                to={`/anime/${anime.mal_id}`}
                className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-lg glass text-white/60 text-xs font-semibold hover:bg-white/10 hover:text-white transition-colors"
              >
                ← Back to details
              </Link>
              {/* No servers available — slug resolved but 0 providers */}
              {!streamError && !streamLoading && providers.length === 0 && anidapSlug !== 'pending' ? (
                <div className="relative text-center p-6 max-w-sm">
                  <AlertCircle className="h-10 w-10 text-yellow-400 mx-auto mb-3" />
                  <p className="text-sm text-white/80 font-semibold mb-1">
                    No servers available
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    {providersUnavailable
                      ? 'This anime isn\'t available on anidap right now.'
                      : 'No playable servers found for this episode.'}
                  </p>
                  {rateLimitSec != null && rateLimitSec > 0 ? (
                    <div className="mb-4">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-[11px] font-semibold text-amber-300">
                          Rate-limited · retry in {Math.ceil(rateLimitSec / 60)} min {rateLimitSec % 60}s
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Auto-retrying when cooldown expires…
                      </p>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <button
                      onClick={() => setServerReloadKey((k) => k + 1)}
                      className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
                    >
                      Retry
                    </button>
                    <Link
                      to={`/anime/${anime.mal_id}`}
                      className="px-4 py-1.5 rounded-lg glass text-white/80 text-xs font-semibold hover:bg-white/10 transition-colors"
                    >
                      Back to details
                    </Link>
                    <Link
                      to="/browse"
                      className="px-4 py-1.5 rounded-lg glass text-white/80 text-xs font-semibold hover:bg-white/10 transition-colors"
                    >
                      Browse trending
                    </Link>
                  </div>
                )
                </div>
              ) : streamError ? (
                <div className="relative text-center p-6 max-w-md">
                  <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
                  <p className="text-sm text-white font-semibold mb-1">
                    Couldn't load this stream
                  </p>
                  <p className="text-xs text-white/70 mb-4">{streamError}</p>
                  {providersUnavailable && rateLimitSec != null && rateLimitSec > 0 && (
                    <div className="mb-4">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                        <span className="text-[11px] font-semibold text-amber-300">
                          Anidap rate-limited · retry in {Math.ceil(rateLimitSec / 60)} min {rateLimitSec % 60}s
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Auto-retrying when cooldown expires…
                      </p>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    <button
                      onClick={() => {
                        setStreamError(null)
                        // If we never even got a provider list, re-fetch it.
                        // Otherwise just re-trigger the current provider.
                        if (providers.length === 0 || !activeProvider) {
                          setServerReloadKey((k) => k + 1)
                        } else {
                          const cur = activeProvider
                          setActiveProvider(null)
                          if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current)
                          retryTimerRef.current = window.setTimeout(() => setActiveProvider(cur), 50)
                        }
                      }}
                      className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
                    >
                      Retry
                    </button>
                    {/* Saturn is the most reliable — show switch button */}
                    {activeProvider !== 'saturn' && providers.some(
                      (p) => p.name === 'saturn' && p.type === streamType,
                    ) && (
                      <button
                        onClick={() => { setStreamError(null); setActiveProvider('saturn') }}
                        className="px-4 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-semibold hover:bg-amber-500/30 transition-colors"
                      >
                        ★ Switch to Saturn
                      </button>
                    )}
                    {providers.length > 1 && (
                      <button
                        onClick={() => {
                          // Cycle to the next provider of the same type
                          const list = providersByType[streamType] || providers
                          const idx = list.findIndex((p) => p.name === activeProvider)
                          const next = list[(idx + 1) % list.length]
                          setStreamError(null)
                          setActiveProvider(next.name)
                        }}
                        className="px-4 py-1.5 rounded-lg glass text-white text-xs font-semibold hover:bg-white/10 transition-colors"
                      >
                        Try next server
                      </button>
                    )}
                    <Link
                      to={`/anime/${anime.mal_id}`}
                      onClick={() => setStreamError(null)}
                      className="px-4 py-1.5 rounded-lg glass text-white/80 text-xs font-semibold hover:bg-white/10 transition-colors"
                    >
                      Back to details
                    </Link>
                  </div>
                </div>
              )              : (
                <div className="relative">
                  <PlayerLoadingStages stage="fetching" detail="Fetching stream from source server…" />
                </div>
              )}
            </div>
          ) : (
            <div className="relative">
              <Suspense fallback={<div className="aspect-video w-full rounded-xl bg-gradient-to-b from-card to-black/80 grid place-items-center border border-white/5"><div className="flex flex-col items-center gap-4"><div className="h-10 w-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" /><span className="animate-pulse text-white/50 text-sm font-medium">Loading player…</span></div></div>}>
              <VideoPlayer
                theaterMode={theaterMode}
                onToggleTheaterMode={() => setTheaterMode((t) => !t)}
                /* Resume-where-you-left-off plumbing. */
                resumeAt={(() => {
                  const saved = malId ? getEpisodeProgress(malId, currentEp) : null
                  return saved?.time ?? null
                })()}
                onProgressTick={onProgressTick}
                onEnded={onVideoEnded}
                onResumeDismiss={() => {
                  if (malId) clearEpisodeProgress(malId, currentEp)
                }}
                src={stream.proxiedUrl}
                fallbackSrc={stream.fallbackProxiedUrl}
                initialTime={timeParam}
                poster={buildEpisodeImageUrl(currentEpisodeMeta, {
                  showCover: getImageUrl(anime),
                  label: currentEp,
                  accent: aniListAccent,
                })}
                skipTimes={skipTimes}
                onNearEnd={onPlayerNearEnd}
                onProgress={onPlayerProgress}
                hasNextEpisode={currentEp < (episodes.length || anime?.episodes || 0)}
                hasPrevEpisode={currentEp > 1}
              onNextEpisode={() => {
                const total = episodes.length || anime?.episodes || 0
                if (currentEp < total) setCurrentEp(currentEp + 1)
              }}
              onPrevEpisode={() => {
                if (currentEp > 1) setCurrentEp(currentEp - 1)
              }}
              onStreamError={() => {
                if (!activeProvider) return
                if (streamLoading) return
                if (failedProviders.has(activeProvider)) return
                if (lastStreamErrorProvider.current === activeProvider) return
                lastStreamErrorProvider.current = activeProvider
                setFailedProviders((prev) => {
                  const next = new Set(prev)
                  next.add(activeProvider)
                  return next
                })
                const newFailed = new Set(failedProviders)
                newFailed.add(activeProvider)
                const sameType = (providersByType[streamType] ?? []).filter(
                  (p) => !newFailed.has(p.name),
                )
                if (sameType.length > 0) {
                  const nextProvider = sameType[0]
                  toast.info(`${activeProvider} failed during playback — switching to ${nextProvider.name}…`, 3000)
                  setActiveProvider(nextProvider.name)
                } else {
                  setStreamLoading(false)
                  setStreamError('All servers exhausted for this episode.')
                  toast.error(`All ${streamType.toUpperCase()} servers exhausted — try another audio type.`)
                }
              }}
                episodeNumber={currentEp}
                episodeTitle={currentEpisodeMeta?.title?.en || currentEpisodeMeta?.title?.['x-jat'] || `Episode ${currentEp}`}
                subtitles={playerSubtitles}
                streamType={streamType}
              />
              </Suspense>
              {/* Autoplay-next countdown */}
              {autoplayCountdown != null && (
                <div className="absolute bottom-6 right-6 z-20 glass-card rounded-2xl px-5 py-4 flex items-center gap-4 shadow-lg border border-primary/30 animate-[fadeInUp_0.3s_ease]">
                  <div className="relative w-10 h-10">
                    <svg className="absolute inset-0 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="16" fill="none" stroke="hsla(0,0%,100%,0.1)" strokeWidth="3"/>
                      <circle cx="18" cy="18" r="16" fill="none" stroke="hsl(245,75%,60%)" strokeWidth="3" strokeDasharray={String(Math.round((autoplayCountdown/autoplayDelay)*100)) + ' 100'} strokeLinecap="round"/>
                    </svg>
                    <span className="absolute inset-0 grid place-items-center text-xs font-bold text-white">{autoplayCountdown}</span>
                  </div>
                  <div className="text-xs">
                    <p className="font-bold text-white tracking-wide">Up Next</p>
                    <p className="text-[11px] text-white/70">EP {currentEp + 1} • {anime.title_english || anime.title}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAutoplayCountdown(null)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white/10 text-white/80 hover:bg-white/15 border border-white/10 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={goToNextEpisode}
                      className="px-3.5 py-1.5 rounded-lg text-[11px] font-bold bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all"
                    >
                      Play
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---- Title bar — anime + episode info right below player ---- */}
          <div className="glass-card rounded-xl p-4">
            <div className="flex items-start gap-4">
              <img
                src={getImageUrl(anime)}
                alt={anime.title}
                className="hidden sm:block w-14 h-20 rounded-lg object-cover shrink-0 border border-white/10 shadow-lg"
              />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/anime/${anime.mal_id}`}
                  className="group block min-h-[32px] sm:min-h-[40px] leading-tight"
                >
                  {/* TMDB logo first, typographic h1 as fallback. AnimatePresence
                      wraps the swap so the crossfade is smooth on logo load. */}
                  {tmdbLogo ? (
                    <img
                      src={getTmdbLogoUrl(tmdbLogo)}
                      srcSet={`${getTmdbLogoUrl(tmdbLogo, 'w300')} 300w, ${getTmdbLogoUrl(tmdbLogo, 'w500')} 500w, ${getTmdbLogoUrl(tmdbLogo, 'original')} 1000w`}
                      sizes="(max-width: 640px) 220px, 280px"
                      alt={anime.title_english || anime.title}
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      className="watch-logo"
                      /* Reserve space using the logo's native aspect ratio so
                         the layout doesn't jump while the PNG streams in. */
                      style={{
                        aspectRatio: `${tmdbLogo.width || 3} / ${tmdbLogo.height || 1}`,
                      }}
                    />
                  ) : (
                    <h1 className="text-base sm:text-lg font-bold text-white group-hover:text-primary transition-colors line-clamp-1 leading-tight">
                      {anime.title_english || anime.title}
                    </h1>
                  )}
                </Link>
                {anidapSlug !== 'pending' && anidapSlug !== 'unavailable' && (
                  <p className="text-sm text-white/70 mt-1 line-clamp-1">
                    <span className="text-primary font-mono font-semibold mr-2">
                      EP {currentEp}
                    </span>
                    {currentEpisodeMeta?.title?.en ||
                     currentEpisodeMeta?.title?.['x-jat'] ||
                     `Episode ${currentEp}`}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {anime.score && (
                    <span className="glass-pill text-yellow-400 border-yellow-500/25 bg-yellow-500/15">
                      <Star className="h-3 w-3 fill-yellow-400" />
                      {formatScore(anime.score)}
                    </span>
                  )}
                  <span className="glass-pill">
                    {anime.type}
                  </span>
                  {anime.episodes && (
                    <span className="glass-pill">
                      {anime.episodes} EP
                    </span>
                  )}
                  {/* Quick audio toggle — switch sub/dub without scrolling to server picker */}
                  {canToggleAudio && (
                    <button
                      onClick={() => {
                        const types: StreamType[] = ['sub', 'dub', 'hsub']
                        const idx = types.indexOf(streamType)
                        let next = types[(idx + 1) % 3]
                        // Skip types that aren't available
                        let attempts = 0
                        while ((!providersByType[next] || providersByType[next].length === 0) && attempts < 3) {
                          next = types[(types.indexOf(next) + 1) % 3]
                          attempts++
                        }
                        const list = providersByType[next] ?? []
                        if (list.length > 0) {
                          setStreamType(next)
                          setActiveProvider(list[0].name)
                          setStreamError(null)
                        }
                      }}
                      title="Switch audio: sub / dub / hsub"
                      className="glass-pill bg-rose-500/10 text-rose-300 border-rose-500/25 hover:bg-rose-500/20"
                    >
                      <Mic className="h-2.5 w-2.5" />
                      {streamType.toUpperCase()}
                    </button>
                  )}
                  {/* Dub availability indicator */}
                  {hasDubAvailable && streamType !== 'dub' && showDubBadges && (
                    <span className="glass-pill text-amber-400/80 border-amber-500/20 bg-amber-500/10">
                      Dub available
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
                {/* Mark current episode as watched / unwatched. */}
                {(() => {
                  const watched = isEpisodeWatched(anime.mal_id, currentEp)
                  return (
                    <button
                      onClick={() => {
                        // markEpisodeWatched is a toggle — clicking when already
                        // marked clears it (see useWatchListStore.ts).
                        // If the anime isn't in the watchlist yet, add it first
                        // so the user gets the full AniList sync experience.
                        checkAndPrompt(() => {
                          if (!inList) addToWatchlist(anime)
                          markEpisodeWatched(anime.mal_id, currentEp)
                        })
                      }}
                      aria-label={watched ? 'Mark as unwatched' : 'Mark as watched'}
                      title={watched ? 'Click to mark as unwatched' : 'Mark as watched'}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border',
                        watched
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                          : 'bg-white/[0.04] border-white/10 text-white/80 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      {watched
                        ? <CheckCircle2 className="h-3.5 w-3.5" />
                        : <Eye className="h-3.5 w-3.5" />}
                      <span className="hidden md:inline">
                        {watched ? 'Watched' : 'Mark watched'}
                      </span>
                    </button>
                  )
                })()}

                {/* Download — only useful when we have a known slug + active provider */}
                {anidapSlug !== 'pending' && anidapSlug !== 'unavailable' && activeProvider && (
                  <DownloadButton
                    slug={anidapSlug}
                    episode={currentEp}
                    provider={activeProvider}
                    type={streamType}
                  />
                )}

                {/* Watchlist */}
                <button
                  onClick={() => inList ? removeFromWatchlist(anime.mal_id) : addToWatchlist(anime)}
                  aria-label={inList ? 'Remove from watchlist' : 'Add to watchlist'}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                    inList
                      ? 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25'
                      : 'bg-primary text-white hover:bg-primary/90 shadow-[0_4px_16px_-4px_hsl(245,75%,60%,0.5)]',
                  )}
                >
                  <Heart className={cn('h-3.5 w-3.5', inList && 'fill-red-400')} />
                  <span className="hidden md:inline">{inList ? 'In list' : 'Add'}</span>
                </button>

                {/* Sleep Timer — SLEEK */}
                <div className="relative">
                  <button
                    onClick={() => {
                      if (sleepActive) {
                        setSleepActive(false)
                        toast.info('Sleep timer cancelled')
                      } else {
                        setSleepDialogOpen(true)
                      }
                    }}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                      sleepActive
                        ? 'bg-violet-500/20 text-violet-300 border-violet-500/40 animate-pulse'
                        : 'bg-white/[0.04] border-white/10 text-white/70 hover:bg-white/10 hover:text-white'
                    )}
                    title="Sleep timer"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                    <span className="hidden md:inline">{sleepActive ? `${sleepMinutes}m` : 'Sleep'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Episode overview */}
            {currentEpisodeMeta?.overview && (
              <div className="mt-3 pt-3 border-t border-white/5">
                <p className={cn(
                  'text-xs text-white/65 leading-relaxed',
                  !expanded && 'line-clamp-2',
                )}>
                  {currentEpisodeMeta.overview}
                </p>
                {currentEpisodeMeta.overview.length > 140 && (
                  <button onClick={() => setExpanded(!expanded)}
                    className="text-[11px] text-primary hover:underline mt-1 font-semibold">
                    {expanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Next-episode airing countdown (only when the show is currently airing). */}
          {nextAiring && (
            <NextEpisodeCountdown
              episode={nextAiring.episode}
              airingAtSeconds={nextAiring.airingAt}
            />
          )}

          {/* ─── Last-episode rating prompt ─── */}
          {isLastEpisode && anilistId && (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] backdrop-blur-md p-4 lg:p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
                  Rate this series
                </h3>
                <p className="text-xs text-white/60 mt-1">
                  You&apos;ve reached the final episode. What did you think of the anime?
                </p>
              </div>
              <div className="bg-black/30 px-3 py-2 rounded-xl ring-1 ring-white/10">
                <StarRating aniId={anilistId} />
              </div>
            </div>
          )}

          {/* ---- Server picker ---- */}
          {anidapSlug !== 'pending' && anidapSlug !== 'unavailable' && (
            <ServerPicker
              providers={providers}
              streamType={streamType}
              activeProvider={activeProvider}
              unavailable={providersUnavailable}
              onChangeProvider={(name) => {
                setStreamError(null)
                setActiveProvider(name)
              }}
              onChangeType={(t) => setStreamType(t as StreamType)}
            />
          )}

        </div>

        {/* ---- Sidebar: episode list ---- */}
        <aside data-lenis-prevent className={cn(
          'space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto custom-scrollbar lg:pr-1',
          'flex flex-col gap-3',
          theaterMode && 'hidden',
        )}>
          {/* Sticky header card — toolbar + search, stays visible while scrolling list */}
          <div className="glass-card rounded-xl p-3 space-y-2.5 shrink-0">
            {/* Header row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-sm font-bold text-white tracking-tight">Episodes</h3>
                {episodes.length > 0 && (
                  <span className="glass-pill text-[10px] font-mono text-muted-foreground">
                    {episodes.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSkipFiller((s) => !s)}
                  className={cn(
                    'glass-pill text-[10px] font-semibold transition-all',
                    skipFiller
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
                      : 'bg-white/[0.03] text-white/55 border-white/8 hover:bg-white/[0.06] hover:text-white/80',
                  )}
                  title={skipFiller ? 'Auto-skip filler episodes' : 'Include filler episodes'}
                >
                  {skipFiller ? 'No filler' : 'All'}
                </button>
                <button
                  onClick={() => setHideWatched((h) => !h)}
                  className={cn(
                    'glass-pill text-[10px] font-semibold transition-all',
                    hideWatched
                      ? 'bg-primary/15 text-primary border-primary/25 hover:bg-primary/20'
                      : 'bg-white/[0.03] text-white/55 border-white/8 hover:bg-white/[0.06] hover:text-white/80',
                  )}
                  title={hideWatched ? 'Show all episodes' : 'Hide watched episodes'}
                >
                  {hideWatched ? 'Unwatched' : 'All'}
                </button>
              </div>
            </div>

            {/* Range picker row */}
            <EpisodeRangePicker
              totalEpisodes={Math.max(
                episodes.length,
                airedThrough ?? totalEpisodes ?? 0,
              )}
              currentEp={currentEp}
              rangeSize={RANGE_SIZE}
              activeRangeStart={activeRangeStart}
              onSelectRange={(start) => setActiveRangeStart(start)}
            />

            {/* Episode search */}
            {episodes.length > 6 && (
              <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 focus-within:border-primary/30 focus-within:bg-white/[0.04] transition-all">
                <Search className="h-3.5 w-3.5 text-white/30 shrink-0" />
                <input
                  type="text"
                  value={epQuery}
                  onChange={(e) => setEpQuery(e.target.value)}
                  placeholder="Search episode…"
                  className="flex-1 bg-transparent border-none outline-none text-xs text-white placeholder:text-white/30"
                />
                {epQuery && (
                  <button
                    onClick={() => setEpQuery('')}
                    aria-label="Clear search"
                    className="text-white/40 hover:text-white/80 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}

            {/* Keyboard shortcuts */}
            <button
              onClick={() => setShowShortcuts(true)}
              className="flex items-center gap-1.5 text-[10px] text-white/35 hover:text-white/70 transition-colors w-full justify-center py-1"
            >
              <Keyboard className="h-3 w-3" />
              Shortcuts
            </button>
          </div>

          {/* Scrollable episode list card — tall enough to show 6 episodes without scrolling */}
          <div className="glass-card rounded-xl flex-1 min-h-0 lg:min-h-[520px] overflow-hidden flex flex-col">
                {episodes.length === 0 ? (
                  // Fallback when AniZip has no data — show a numeric grid
                  <div className="p-3">
                    {(() => {
                      const total = totalEpisodes ?? anime.episodes ?? 0
                      const buttonCount = airedThrough ?? total
                      if (buttonCount < 1) {
                        return (
                          <div className="flex flex-col items-center gap-2 py-8 text-center">
                            <Film className="h-6 w-6 text-white/10" />
                            <p className="text-xs text-white/40">
                              {total > 0
                                ? 'No episodes aired yet'
                                : 'No episode data available'}
                            </p>
                          </div>
                        )
                      }
                      const useRange = buttonCount > RANGE_SIZE
                      const rangeEnd = useRange
                        ? Math.min(activeRangeStart + RANGE_SIZE - 1, buttonCount)
                        : buttonCount
                      const rangeStart = useRange ? activeRangeStart : 1
                      return (
                        <div className="space-y-2">
                          <div className="grid grid-cols-6 gap-1.5">
                            {Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i).map((n) => (
                              <button
                                key={n}
                                onClick={() => setCurrentEp(n)}
                                className={cn(
                                  'aspect-square rounded-lg text-xs font-mono font-semibold transition-all duration-200',
                                  n === currentEp
                                    ? 'bg-primary text-white shadow-lg shadow-primary/25 scale-105'
                                    : 'bg-white/[0.06] text-white/50 hover:bg-white/[0.12] hover:text-white/80 hover:scale-105',
                                )}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                          {total > buttonCount && (
                            <p className="text-[10px] text-white/30 text-center">
                              {buttonCount} aired of {total} planned
                            </p>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                ) : (
                  <div ref={epListRef} data-lenis-prevent className="overflow-y-auto custom-scrollbar p-2 flex-1">
                    {shouldVirtualize ? (
                      <div style={{ height: `${episodeVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                        {episodeVirtualizer.getVirtualItems().map((vItem) => {
                          const ep = filteredEpisodes[vItem.index]
                          if (!ep) return null
                          const watched = isEpisodeWatched(anime.mal_id, ep.episode)
                          const isCurrent = ep.episode === currentEp
                          const epTitle = ep.title?.en || ep.title?.['x-jat'] || null
                          const filler = isFiller(ep.episode, fillerInfo)
                          const isMixed = fillerInfo?.mixed?.includes(Number(ep.episode)) ?? false
                          const progress = malId ? getEpisodeProgress(malId, ep.episode) : null
                          const progressPct = progress && progress.duration > 0 ? Math.min((progress.time / progress.duration) * 100, 100) : 0
                          const isMostlyDone = progressPct >= 90
                          return (
                            <div key={vItem.key} data-index={vItem.index} ref={episodeVirtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vItem.start}px)` }}>
                              <EpisodePreviewTooltip episode={ep.episode} title={epTitle} overview={ep.overview ?? null} image={buildEpisodeImageUrl(ep, { showCover: getImageUrl(anime), label: ep.episode })} durationMin={ep.runtime ?? null} isCurrent={isCurrent} isWatched={watched}>
                                <motion.button ref={isCurrent ? currentEpBtnRef : undefined} onClick={() => { setCurrentEp(ep.episode) }} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} className={cn('group w-full flex items-center gap-2.5 p-2 rounded-xl transition-all text-left relative overflow-hidden', isCurrent ? 'bg-primary/10 border-2 border-primary/50 shadow-[0_0_20px_-6px_hsl(245,75%,60%,0.4)]' : 'bg-white/[0.02] hover:bg-white/[0.05] border-2 border-transparent hover:border-white/8')}>
                                  {isCurrent && (<div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full" style={{ background: aniListAccent ? `linear-gradient(180deg, ${aniListAccent}, ${aniListAccent}88)` : 'linear-gradient(180deg, hsl(245,75%,60%), hsl(245,75%,60%,0.5))' }} />)}
                                  <div className="relative shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-card to-black/60 shadow-md" style={{ width: 120, height: 68 }}>
                                    <img src={buildEpisodeImageUrl(ep, { showCover: getImageUrl(anime), label: ep.episode, accent: aniListAccent })} alt={`Episode ${ep.episode}`} loading="lazy" decoding="async" className={cn('h-full w-full object-cover group-hover:scale-110 transition-transform duration-500 ease-out', watched && !isCurrent && 'grayscale-[50%] opacity-60')} onError={(e) => { const img = e.currentTarget; if (!img.dataset.fallbackTried && getImageUrl(anime)) { img.dataset.fallbackTried = '1'; img.src = buildEpisodeImageUrl(null, { showCover: getImageUrl(anime), label: ep.episode, accent: aniListAccent }) } }} />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                                    <span className="absolute bottom-1.5 left-1.5 glass-pill py-0.5 px-1.5 text-[9px] font-bold font-mono text-white/90 bg-black/70 border-white/10 shadow-lg">{ep.episode}</span>
                                    {(filler || isMixed) && (<span className={cn('absolute top-1.5 left-1.5 glass-pill text-[8px] font-bold uppercase tracking-wider py-0.5 px-1.5 shadow-lg', isMixed ? 'bg-purple-500/80 text-white border-purple-400/40' : 'bg-amber-500/80 text-white border-amber-400/40')}>{isMixed ? 'MIXED CANON' : 'FILLER'}</span>)}
                                    {isCurrent && (<div className="absolute inset-0 grid place-items-center bg-primary/30"><div className="h-8 w-8 rounded-full bg-primary/90 grid place-items-center shadow-lg shadow-primary/40"><Play className="h-3.5 w-3.5 text-white fill-white ml-0.5" /></div></div>)}
                                    {watched && !isCurrent && (<div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-emerald-500/90 grid place-items-center shadow-md"><CheckCircle2 className="h-3 w-3 text-white" /></div>)}
                                    {isCurrent && (<span className="absolute top-1.5 right-1.5 glass-pill py-0.5 px-1.5 text-[8px] font-bold uppercase tracking-wider bg-black/70 border-white/10 text-white/80 shadow-lg">{streamType.toUpperCase()}</span>)}
                                    {ep.runtime && (<span className="absolute bottom-1.5 right-1.5 glass-pill py-0.5 px-1.5 text-[9px] font-mono text-white/60 bg-black/60 border-white/10 shadow-lg">{ep.runtime}m</span>)}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className={cn('text-xs leading-tight line-clamp-2 transition-colors', isCurrent ? 'text-white font-semibold' : watched ? 'text-white/40 line-through decoration-white/20' : 'text-white/75 group-hover:text-white/90')}>{epTitle || `Episode ${ep.episode}`}</p>
                                    {isCurrent && (<div className="flex items-center gap-1.5 mt-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /><span className="text-[9px] font-semibold text-primary uppercase tracking-wider">Now playing</span></div>)}
                                  </div>
                                  {progressPct > 0 && !watched && (<div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.03]"><div className={cn('h-full transition-all duration-500 rounded-r-full', isMostlyDone ? 'bg-emerald-500/70' : 'bg-primary/60')} style={{ width: `${Math.max(3, progressPct)}%` }} /></div>)}
                                </motion.button>
                              </EpisodePreviewTooltip>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="space-y-1">
                      {filteredEpisodes.map((ep) => {
                        const watched = isEpisodeWatched(anime.mal_id, ep.episode)
                        const isCurrent = ep.episode === currentEp
                        const epTitle = ep.title?.en || ep.title?.['x-jat'] || null
                        const filler = isFiller(ep.episode, fillerInfo)
                        const isMixed = fillerInfo?.mixed?.includes(Number(ep.episode)) ?? false
                        const progress = malId ? getEpisodeProgress(malId, ep.episode) : null
                        const progressPct = progress && progress.duration > 0 ? Math.min((progress.time / progress.duration) * 100, 100) : 0
                        const isMostlyDone = progressPct >= 90
                        return (
                          <EpisodePreviewTooltip key={ep.episode} episode={ep.episode} title={epTitle} overview={ep.overview ?? null} image={buildEpisodeImageUrl(ep, { showCover: getImageUrl(anime), label: ep.episode })} durationMin={ep.runtime ?? null} isCurrent={isCurrent} isWatched={watched}>
                            <motion.button ref={isCurrent ? currentEpBtnRef : undefined} onClick={() => { setCurrentEp(ep.episode) }} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} className={cn('group w-full flex items-center gap-2.5 p-2 rounded-xl transition-all text-left relative overflow-hidden', isCurrent ? 'bg-primary/10 border-2 border-primary/50 shadow-[0_0_20px_-6px_hsl(245,75%,60%,0.4)]' : 'bg-white/[0.02] hover:bg-white/[0.05] border-2 border-transparent hover:border-white/8')}>
                              {isCurrent && (<div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full" style={{ background: aniListAccent ? `linear-gradient(180deg, ${aniListAccent}, ${aniListAccent}88)` : 'linear-gradient(180deg, hsl(245,75%,60%), hsl(245,75%,60%,0.5))' }} />)}
                              <div className="relative shrink-0 rounded-lg overflow-hidden bg-gradient-to-br from-card to-black/60 shadow-md" style={{ width: 120, height: 68 }}>
                                <img src={buildEpisodeImageUrl(ep, { showCover: getImageUrl(anime), label: ep.episode, accent: aniListAccent })} alt={`Episode ${ep.episode}`} loading="lazy" decoding="async" className={cn('h-full w-full object-cover group-hover:scale-110 transition-transform duration-500 ease-out', watched && !isCurrent && 'grayscale-[50%] opacity-60')} onError={(e) => { const img = e.currentTarget; if (!img.dataset.fallbackTried && getImageUrl(anime)) { img.dataset.fallbackTried = '1'; img.src = buildEpisodeImageUrl(null, { showCover: getImageUrl(anime), label: ep.episode, accent: aniListAccent }) } }} />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                                <span className="absolute bottom-1.5 left-1.5 glass-pill py-0.5 px-1.5 text-[9px] font-bold font-mono text-white/90 bg-black/70 border-white/10 shadow-lg">{ep.episode}</span>
                                {(filler || isMixed) && (<span className={cn('absolute top-1.5 left-1.5 glass-pill text-[8px] font-bold uppercase tracking-wider py-0.5 px-1.5 shadow-lg', isMixed ? 'bg-purple-500/80 text-white border-purple-400/40' : 'bg-amber-500/80 text-white border-amber-400/40')}>{isMixed ? 'MIXED CANON' : 'FILLER'}</span>)}
                                {isCurrent && (<div className="absolute inset-0 grid place-items-center bg-primary/30"><div className="h-8 w-8 rounded-full bg-primary/90 grid place-items-center shadow-lg shadow-primary/40"><Play className="h-3.5 w-3.5 text-white fill-white ml-0.5" /></div></div>)}
                                {watched && !isCurrent && (<div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-emerald-500/90 grid place-items-center shadow-md"><CheckCircle2 className="h-3 w-3 text-white" /></div>)}
                                {isCurrent && (<span className="absolute top-1.5 right-1.5 glass-pill py-0.5 px-1.5 text-[8px] font-bold uppercase tracking-wider bg-black/70 border-white/10 text-white/80 shadow-lg">{streamType.toUpperCase()}</span>)}
                                {ep.runtime && (<span className="absolute bottom-1.5 right-1.5 glass-pill py-0.5 px-1.5 text-[9px] font-mono text-white/60 bg-black/60 border-white/10 shadow-lg">{ep.runtime}m</span>)}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className={cn('text-xs leading-tight line-clamp-2 transition-colors', isCurrent ? 'text-white font-semibold' : watched ? 'text-white/40 line-through decoration-white/20' : 'text-white/75 group-hover:text-white/90')}>{epTitle || `Episode ${ep.episode}`}</p>
                                {isCurrent && (<div className="flex items-center gap-1.5 mt-1.5"><span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /><span className="text-[9px] font-semibold text-primary uppercase tracking-wider">Now playing</span></div>)}
                              </div>
                              {progressPct > 0 && !watched && (<div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.03]"><div className={cn('h-full transition-all duration-500 rounded-r-full', isMostlyDone ? 'bg-emerald-500/70' : 'bg-primary/60')} style={{ width: `${Math.max(3, progressPct)}%` }} /></div>)}
                            </motion.button>
                          </EpisodePreviewTooltip>
                        )
                      })}
                      </div>
                    )}
                  </div>
                )}
              </div>

          {/* Details card */}
          <div className="glass-card rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-white">Details</h3>
            <div className="space-y-2 text-sm">
              {anime.aired?.string && (
                <div className="flex items-center gap-2 text-white/60">
                  <Calendar className="h-3.5 w-3.5 shrink-0" /><span>{anime.aired.string}</span>
                </div>
              )}
              {anime.season && anime.year && (
                <div className="flex items-center gap-2 text-white/60">
                  <Globe className="h-3.5 w-3.5 shrink-0" /><span className="capitalize">{anime.season} {anime.year}</span>
                </div>
              )}
              {anime.rating && (
                <div className="flex items-center gap-2 text-white/60">
                  <Hash className="h-3.5 w-3.5 shrink-0" /><span>{anime.rating}</span>
                </div>
              )}
              {anime.rank && (
                <div className="flex items-center gap-2 text-white/60">
                  <Star className="h-3.5 w-3.5 shrink-0" /><span>#{anime.rank} Ranked</span>
                </div>
              )}

            </div>
          </div>

          {/* Relations — next season, OVA, sequel */}
          <Relations anilistId={anilistId} />
        </aside>
      </div>

      {/* Sync confirmation dialog */}
      <SyncConfirmDialog
        open={syncDialogOpen}
        type="anime"
        title={anime?.title_english || anime?.title || 'Anime'}
        malId={malId}
        onConfirm={handleConfirm}
        onDecline={onSyncDecline}
        onClose={_handleDecline}
      />

      <SleepTimerDialog
        open={sleepDialogOpen}
        onClose={() => setSleepDialogOpen(false)}
        onStart={(mins) => {
          setSleepMinutes(mins)
          setSleepActive(true)
        }}
      />

      <KeyboardShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {recommendations.length > 0 && (
        <section className="max-w-[1600px] mx-auto px-4 mt-8 pb-8">
          <div className="glass-card rounded-2xl p-5 sm:p-6 relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/80 rounded-r-full" />
            <h2 className="text-lg sm:text-xl font-bold text-white mb-6 flex items-center gap-2.5">
              <span className="kicker-bar" /> You Might Also Like
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-x-4 gap-y-6">
              {recommendations.map((rec) => (
                <AnimeCard key={rec.mal_id} anime={rec} />
              ))}
            </div>
          </div>
        </section>
      )}

    </div>
  )
}
