import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, BookOpen, Hash, Star, Globe, Calendar, Loader2, Search, X, Heart, ChevronDown, ChevronUp, Library, TrendingUp, Palette, Play } from 'lucide-react'
import { cn } from '../lib/utils'
import { getMangaInfo, getChapterFeed, searchManga as searchMangaDex, type MangaDexManga, type MangaDexChapter } from '../api/mangadex'
import { resolveManga, type ResolvedManga } from '../api/anilistManga'
import { searchManga as searchMangaAtsu, getChapterFeed as getChapterFeedAtsu, type AtsuChapter } from '../api/atsu'
import { useWatchListStore } from '../store/useWatchListStore'
import { useMangaListStore } from '../store/useMangaListStore'
import { useReaderStore, type ReadingDir, type ReadMode } from '../store/useReaderStore'
import PillSegmented from '../components/settings/PillSegmented'
import { isColoredChapter, hasColoredEditionAtsu, KNOWN_COLORED_MANGA } from '../api/coloredManga'
import { useTitle } from '../hooks/useTitle'

export default function MangaDetails() {
  const { id } = useParams<{ id: string }>()
  const mangaId = id || ''

  const [searchParams, setSearchParams] = useSearchParams()
  const coloredMode = searchParams.get('colored') === '1'

  // Is MangaDex ID
  const isMangaDex = mangaId.includes('-')
  const anilistId = isMangaDex ? null : Number(mangaId)

  // Resolve manga (handles coloured editions)
  const resolveQuery = useQuery({
    queryKey: ['manga', 'resolve', mangaId],
    queryFn: () => isMangaDex
      ? Promise.resolve(null)
      : resolveManga(anilistId!, 'anilist'),
    enabled: !isMangaDex && !!anilistId,
    staleTime: 30 * 60 * 1000,
  })

  const resolved: ResolvedManga | null = resolveQuery.data ?? null

  // MangaDex detail
  const mdQuery = useQuery({
    queryKey: ['mangadex', 'info', mangaId],
    queryFn: () => getMangaInfo(mangaId),
    enabled: isMangaDex,
    staleTime: 10 * 60 * 1000,
  })

  // When coming from AniList, search MangaDex by title
  const mdSearchQuery = useQuery({
    queryKey: ['mangadex', 'anisearch', mangaId, resolveQuery.data?.displayTitle],
    queryFn: async () => {
      const title = resolveQuery.data?.parentTitle || resolveQuery.data?.displayTitle || ''
      if (!title) return null
      const results = await searchMangaDex(title, 1)
      return results.results[0] || null
    },
    enabled: !isMangaDex && resolveQuery.isSuccess && !!resolveQuery.data?.displayTitle,
    staleTime: 30 * 60 * 1000,
  })

  const resolvedMdId: string | null = isMangaDex ? mangaId : (mdSearchQuery.data?.id || null)

  // Atsu.moe parallel search — alternative source with full page data
  const atsuSearchQuery = useQuery({
    queryKey: ['atsu', 'search', mangaId, resolveQuery.data?.displayTitle],
    queryFn: async () => {
      const title = resolveQuery.data?.parentTitle || resolveQuery.data?.displayTitle || ''
      if (!title) return null
      const results = await searchMangaAtsu(title, 3)
      return results.results[0] || null
    },
    enabled: !isMangaDex && resolveQuery.isSuccess && !!resolveQuery.data?.displayTitle,
    staleTime: 30 * 60 * 1000,
  })

  const resolvedAtsuId: string | null = atsuSearchQuery.data?.id || null

  // Chapter feed from atsu.moe
  const atsuChaptersQuery = useQuery({
    queryKey: ['atsu', 'chapters', resolvedAtsuId],
    queryFn: () => getChapterFeedAtsu(resolvedAtsuId!),
    enabled: !!resolvedAtsuId,
    staleTime: 5 * 60 * 1000,
  })

  const atsuChapters: AtsuChapter[] = atsuChaptersQuery.data?.chapters ?? []
  const hasAtsuSource = atsuChapters.length > 0

  // Chapter feed from MangaDex
  const chaptersQuery = useQuery({
    queryKey: ['mangadex', 'chapters', resolvedMdId],
    queryFn: () => getChapterFeed(resolvedMdId!, 'en', 500),
    enabled: !!resolvedMdId,
    staleTime: 5 * 60 * 1000,
  })

  const manga: MangaDexManga | null = mdQuery.data ?? null
  const allMdChapters: MangaDexChapter[] = chaptersQuery.data?.chapters ?? []
  // Filter out MangaPlus chapters with 0 pages (metadata-only, no images)
  const mdChapters = useMemo(
    () => allMdChapters.filter((c) => c.pages > 0),
    [allMdChapters],
  )
  const hasMdChapters = mdChapters.length > 0
  const mdMangaPlusCount = allMdChapters.length - mdChapters.length

  const isInWatchlist = useWatchListStore((s) => s.isInWatchlist)
  const addToWatchlist = useWatchListStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useWatchListStore((s) => s.removeFromWatchlist)
  const trackMalId = resolved?.malId ?? (isMangaDex ? null : anilistId)
  const inList = trackMalId ? isInWatchlist(trackMalId) : false

  const isInMangaList = useMangaListStore((s) => s.isInMangaList)
  const addToMangaList = useMangaListStore((s) => s.addToMangaList)
  const removeFromMangaList = useMangaListStore((s) => s.removeFromMangaList)
  const isChapterRead = useMangaListStore((s) => s.isChapterRead)
  const getReadCount = useMangaListStore((s) => s.getReadCount)
  const getLatestChapter = useMangaListStore((s) => s.getLatestChapter)
  const inMangaList = trackMalId ? isInMangaList(trackMalId) : false
  const readCount = trackMalId ? getReadCount(trackMalId) : 0
  const latestRead = trackMalId ? getLatestChapter(trackMalId) : null

  useTitle(manga?.title || resolved?.displayTitle || 'Manga')

  // ── Next unread chapter for Continue Reading ──
  const nextUnreadChapter = useMemo(() => {
    if (!trackMalId || latestRead == null) return null
    const target = latestRead + 1

    // Check MangaDex chapters first
    const mdNext = [...mdChapters]
      .sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter))
      .find((ch) => {
        const num = parseFloat(ch.chapter)
        return !isNaN(num) && num >= target
      })
    if (mdNext) {
      return { id: mdNext.id, chapter: mdNext.chapter, source: 'mangadex' as const }
    }

    // Fall back to atsu.moe chapters
    const atsuNext = [...atsuChapters]
      .sort((a, b) => parseFloat(a.chapter) - parseFloat(b.chapter))
      .find((ch) => {
        const num = parseFloat(ch.chapter)
        return !isNaN(num) && num >= target
      })
    if (atsuNext) {
      return { id: atsuNext.id, chapter: atsuNext.chapter, source: 'atsu' as const }
    }

    return null
  }, [trackMalId, latestRead, mdChapters, atsuChapters])

  // ── Auto-scroll to next unread chapter ──
  const scrolledToUnread = useRef(false)
  // Reset the flag when nextUnreadChapter changes so the sidebar
  // re-positions on every chapter advancement.
  useEffect(() => {
    scrolledToUnread.current = false
  }, [nextUnreadChapter?.id])
  useEffect(() => {
    if (scrolledToUnread.current || !nextUnreadChapter) return
    // Small delay for DOM render
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-chapter-id="${nextUnreadChapter.id}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        scrolledToUnread.current = true
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [nextUnreadChapter?.id])

  // ── Colored chapter detection (scanned from already-fetched data) ──
  const mdColoredSet = useMemo(() => {
    const set = new Set<string>()
    for (const ch of mdChapters) {
      if (isColoredChapter({ title: ch.title, scanGroup: ch.scanGroup })) {
        set.add(ch.chapter)
      }
    }
    return set
  }, [mdChapters])

  const atsuColoredSet = useMemo(() => {
    const set = new Set<string>()
    for (const ch of atsuChapters) {
      if (isColoredChapter({ title: ch.title, scanGroup: ch.scanGroup })) {
        set.add(ch.chapter)
      }
    }
    return set
  }, [atsuChapters])

  // ── Dedicated atsu colored-edition API call (supplements local scan) ──
  // atsu.moe chapter metadata sometimes doesn't include "colored" keywords directly,
  // so we use hasColoredEditionAtsu which fetches ALL chapters and scans them.
  const atsuColoredApiQuery = useQuery({
    queryKey: ['colored', 'atsu', resolvedAtsuId],
    queryFn: () => hasColoredEditionAtsu(resolvedAtsuId!),
    enabled: !!resolvedAtsuId && hasAtsuSource && atsuColoredSet.size === 0,
    staleTime: 30 * 60 * 1000,
  })

  // Merge local scan + API results into a reactive derived set
  const effectiveAtsuColoredSet = useMemo(() => {
    const merged = new Set(atsuColoredSet)
    const api = atsuColoredApiQuery.data?.coloredChapters
    if (api) { for (const n of api) merged.add(String(n)) }
    return merged
  }, [atsuColoredSet, atsuColoredApiQuery.data?.coloredChapters])

  // Check if this manga is a known colored edition (hardcoded fallback)
  const isKnownColored = useMemo(() => {
    const title = (resolved?.parentTitle || resolved?.displayTitle || manga?.title || '').toLowerCase()
    for (const entry of KNOWN_COLORED_MANGA) {
      if (title.includes(entry.title.toLowerCase())) return true
    }
    return false
  }, [resolved?.parentTitle, resolved?.displayTitle, manga?.title])

  const hasColoredChapters = mdColoredSet.size > 0
    || effectiveAtsuColoredSet.size > 0
    || isKnownColored

  const toggleColoredMode = () => {
    const next = new URLSearchParams(searchParams)
    if (coloredMode) {
      next.delete('colored')
    } else {
      next.set('colored', '1')
    }
    setSearchParams(next, { replace: true })
  }

  // Expandable synopsis
  const [synopsisExpanded, setSynopsisExpanded] = useState(false)

  // Search/filter chapters
  const [chQuery, setChQuery] = useState('')
  const filteredChapters = useMemo(() => {
    if (!chQuery.trim()) return mdChapters
    const q = chQuery.toLowerCase()
    return mdChapters.filter((c) =>
      c.chapter.includes(q) || (c.title || '').toLowerCase().includes(q)
    )
  }, [mdChapters, chQuery])

  const filteredAtsuChapters = useMemo(() => {
    if (!chQuery.trim()) return atsuChapters
    const q = chQuery.toLowerCase()
    return atsuChapters.filter((c) =>
      c.chapter.includes(q) || (c.title || '').toLowerCase().includes(q)
    )
  }, [atsuChapters, chQuery])

  // Group chapters by volume
  const volumeGroups = useMemo(() => {
    const groups: Record<string, MangaDexChapter[]> = {}
    for (const ch of filteredChapters.length > 0 && chQuery ? filteredChapters : mdChapters) {
      const vol = ch.volume || 'Unknown'
      ;(groups[vol] ||= []).push(ch)
    }
    const sorted = Object.entries(groups).sort((a, b) => {
      const na = Number(a[0]); const nb = Number(b[0])
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a[0] < b[0] ? -1 : 1
    })
    return sorted
  }, [mdChapters, filteredChapters, chQuery])

  const loading = resolveQuery.isLoading || mdQuery.isLoading
  const detail = resolved?.detail

  // Related manga from AniList relations
  const relatedManga = useMemo(() => {
    if (!detail?.relations?.edges) return []
    return detail.relations.edges
      .filter((e) => e.node.idMal || e.node.title)
      .slice(0, 6)
      .map((e) => ({
        id: e.node.id,
        title: e.node.title.english || e.node.title.romaji || 'Untitled',
        relationType: e.relationType.replace(/_/g, ' ').toLowerCase(),
        format: e.node.format || null,
      }))
  }, [detail])

  if (loading) {
    return (
      <div className="pt-20 pb-12 mx-4">
        <div className="animate-pulse max-w-7xl mx-auto">
          <div className="h-[400px] bg-card rounded-2xl mb-8" />
        </div>
      </div>
    )
  }

  return (
    <div className="pt-20 pb-12 px-4 max-w-[1600px] mx-auto">
      {/* Back link */}
      <Link
        to="/manga"
        className="inline-flex items-center gap-1.5 text-xs text-white/55 hover:text-white transition-colors group mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
        Back to Manga
      </Link>

      {/* Coloured edition banner */}
      {resolved?.isColoured && resolved.parentTitle && (
        <div className="mb-4 p-3 rounded-xl bg-primary/10 border border-primary/20 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-primary shrink-0" />
          <p className="text-xs text-white/80">
            This is a <span className="text-primary font-semibold">coloured edition</span> of{' '}
            <span className="text-white font-semibold">{resolved.parentTitle}</span>.
            Tracking as the original manga.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
        {/* Cover + info sidebar */}
        <div className="space-y-4 lg:sticky lg:top-20">
          {/* Cover */}
          <div className="rounded-xl overflow-hidden border border-white/10 aspect-[3/4] bg-card relative">
            {manga?.coverUrl ? (
              <img src={manga.coverUrl} alt={manga.title} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : detail?.coverImage?.large ? (
              <img src={detail.coverImage.large} alt={resolved?.displayTitle || ''} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : (
              <div className="h-full w-full grid place-items-center">
                <BookOpen className="h-12 w-12 text-white/10" />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {/* Manga reading list button */}
            {trackMalId != null && (
              <button
                onClick={() => {
                  if (inMangaList) {
                    removeFromMangaList(trackMalId)
                  } else {
                    addToMangaList({
                      mal_id: trackMalId,
                      anilistId: anilistId ?? null,
                      mangaDexId: resolvedMdId,
                      title: resolved?.parentTitle || resolved?.displayTitle || manga?.title || 'Manga',
                      title_english: resolved?.parentTitle || resolved?.displayTitle || manga?.title || null,
                      coverUrl: detail?.coverImage?.large || manga?.coverUrl || '',
                      chapters: detail?.chapters ?? null,
                      format: detail?.format ?? null,
                      status: detail?.status ?? null,
                      genres: detail?.genres || [],
                    })
                  }
                }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border',
                  inMangaList
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                    : 'bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20',
                )}
              >
                <BookOpen className={cn('h-4 w-4', inMangaList && 'fill-emerald-400')} />
                {inMangaList ? 'In Manga List' : 'Start Reading'}
              </button>
            )}

            {/* Reading progress card */}
            {inMangaList && detail?.chapters != null && readCount > 0 && (
              <div className="glass-card rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-white">Reading Progress</span>
                  <span className="text-[10px] text-emerald-400 font-bold">{Math.round((readCount / detail.chapters) * 100)}%</span>
                </div>
                <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/60 rounded-full transition-all"
                    style={{ width: `${Math.min((readCount / detail.chapters) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{readCount} of {detail.chapters} chapters read</span>
                  {latestRead && <span>Latest: Ch. {latestRead}</span>}
                </div>
              </div>
            )}

            {/* Continue Reading button */}
            {inMangaList && nextUnreadChapter && (
              <Link
                to={`/manga/read/${nextUnreadChapter.id}?manga=${resolvedMdId || mangaId}&malId=${trackMalId}&source=${nextUnreadChapter.source}`}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
              >
                <Play className="h-4 w-4 fill-white" />
                Continue Ch. {nextUnreadChapter.chapter}
              </Link>
            )}

            {/* Anime watchlist button (secondary) */}
            {trackMalId != null && (
              <button
                onClick={() => {
                  if (inList) {
                    removeFromWatchlist(trackMalId)
                  } else {
                    const title = resolved?.parentTitle || resolved?.displayTitle || manga?.title || 'Manga'
                    const coverUrl = detail?.coverImage?.large || manga?.coverUrl || ''
                    addToWatchlist({
                      mal_id: trackMalId,
                      title,
                      title_english: title,
                      images: {
                        webp: { image_url: coverUrl, large_image_url: coverUrl, small_image_url: coverUrl },
                        jpg: { image_url: coverUrl, large_image_url: coverUrl, small_image_url: coverUrl },
                      },
                      type: 'Manga',
                      score: null,
                      episodes: detail?.chapters || null,
                      genres: (detail?.genres || []).map((g) => ({ name: g, mal_id: 0, type: 'genre' })),
                      synopsis: detail?.description || '',
                      status: detail?.status || 'Unknown',
                      aired: { string: detail?.startDate?.year ? String(detail.startDate.year) : '' },
                    } as any)
                  }
                }}
                className={cn(
                  'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border',
                  inList
                    ? 'bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25'
                    : 'bg-white/[0.04] text-white/55 border-white/8 hover:bg-white/[0.08] hover:text-white',
                )}
              >
                <Heart className={cn('h-4 w-4', inList && 'fill-red-400')} />
                {inList ? 'In My List' : 'Add to My List'}
              </button>
            )}
          </div>

          {/* Per-manga reader overrides */}
          {trackMalId != null && <ReaderOverridePanel malId={trackMalId} />}

          {/* Quick stats */}
          {(detail || manga) && (
            <div className="glass-card rounded-2xl p-4 space-y-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="h-3.5 w-3.5" />
                </span>
                Details
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {detail?.format && (
                  <span className="glass-pill">
                    <BookOpen className="h-3 w-3" />
                    {detail.format}
                  </span>
                )}
                {detail?.status && (
                  <span className="glass-pill capitalize">
                    <Globe className="h-3 w-3" />
                    {detail.status.replace(/_/g, ' ')}
                  </span>
                )}
                {manga?.status && (
                  <span className="glass-pill capitalize">
                    <Globe className="h-3 w-3" />
                    {manga.status}
                  </span>
                )}
                {detail?.chapters != null && (
                  <span className="glass-pill">
                    <Hash className="h-3 w-3" />
                    {detail.chapters} Chapters
                  </span>
                )}
                {detail?.volumes != null && (
                  <span className="glass-pill">
                    <Library className="h-3 w-3" />
                    {detail.volumes} Volumes
                  </span>
                )}
                {detail?.averageScore && (
                  <span className="glass-pill text-yellow-400 border-yellow-500/25 bg-yellow-500/15">
                    <Star className="h-3 w-3 fill-yellow-400" />
                    {(detail.averageScore / 10).toFixed(1)}
                  </span>
                )}
                {detail?.popularity && (
                  <span className="glass-pill">
                    <TrendingUp className="h-3 w-3" />
                    #{detail.popularity.toLocaleString()}
                  </span>
                )}
                {detail?.startDate?.year && (
                  <span className="glass-pill">
                    <Calendar className="h-3 w-3" />
                    {detail.startDate.year}
                    {detail.startDate.month ? `.${String(detail.startDate.month).padStart(2, '0')}` : ''}
                  </span>
                )}
                {manga?.year && (
                  <span className="glass-pill">
                    <Calendar className="h-3 w-3" />
                    {manga.year}
                  </span>
                )}
              </div>
              {detail?.genres && detail.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {detail.genres.slice(0, 6).map((g) => (
                    <span key={g} className="glass-pill text-[10px]">
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Main content — title + chapters */}
        <div className="space-y-6 min-w-0">
          {/* Title + description */}
          <div>
            <h1 className="text-2xl font-bold text-white mb-2">
              {resolved?.parentTitle || resolved?.displayTitle || manga?.title || 'Manga'}
            </h1>
            {resolved?.isColoured && resolved.displayTitle !== resolved.parentTitle && (
              <p className="text-sm text-primary/70 mb-2">{resolved.displayTitle}</p>
            )}
            {(detail?.description || manga?.description) && (
              <div className="relative">
                <p className={cn(
                  'text-sm text-white/55 leading-relaxed',
                  !synopsisExpanded && 'line-clamp-4',
                )}>
                  {detail?.description || manga?.description}
                </p>
                {(detail?.description || '').length > 300 && (
                  <button
                    onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                    className="mt-1 flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    {synopsisExpanded ? (
                      <><ChevronUp className="h-3 w-3" /> Show less</>
                    ) : (
                      <><ChevronDown className="h-3 w-3" /> Read more</>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Related manga */}
          {relatedManga.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="kicker-bar" />
                Related Manga
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {relatedManga.map((r) => (
                  <Link
                    key={r.id}
                    to={`/manga/${r.id}`}
                    className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-primary/20 transition-all"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] text-white/85 font-medium line-clamp-1">{r.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-primary/60 capitalize">{r.relationType}</span>
                        {r.format && (
                          <span className="text-[9px] text-white/25">{r.format}</span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Edition toggle */}
          {hasColoredChapters && (
            <div className="flex items-center gap-3">
              <button
                onClick={toggleColoredMode}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all border',
                  coloredMode
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/20'
                    : 'bg-white/[0.03] text-white/70 border-white/[0.06] hover:bg-white/[0.06] hover:text-white',
                )}
              >
                <Palette className="h-3.5 w-3.5" />
                {coloredMode ? '🎨 Colored Edition' : ' Regular Edition'}
              </button>
              {coloredMode && (
                <span className="glass-pill text-amber-400/80 border-amber-500/20 bg-amber-500/10">
                  {mdColoredSet.size + effectiveAtsuColoredSet.size} colored chapter{(mdColoredSet.size + effectiveAtsuColoredSet.size) !== 1 ? 's' : ''} available
                </span>
              )}
            </div>
          )}

          {/* Colored mode banner */}
          {coloredMode && hasColoredChapters && (
            <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/15 flex items-center gap-2">
              <Palette className="h-4 w-4 text-amber-400 shrink-0" />
              <p className="text-xs text-white/75">
                Viewing <span className="text-amber-400 font-semibold">colored edition</span> — non-colored chapters are grayed out.
              </p>
              <button
                onClick={toggleColoredMode}
                className="ml-auto text-[10px] text-amber-400 hover:text-amber-200 font-medium underline transition-colors shrink-0"
              >
                Switch to regular
              </button>
            </div>
          )}

          {/* Chapter search + count */}
          {(hasMdChapters || hasAtsuSource) && (
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-2 mr-2">
                <span className="kicker-bar" />
                {hasAtsuSource ? `${atsuChapters.length} Chapter${atsuChapters.length !== 1 ? 's' : ''}` : `${mdChapters.length} Chapter${mdChapters.length !== 1 ? 's' : ''}`}
              </h3>
              {(mdChapters.length > 10 || atsuChapters.length > 10) && (
                <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 focus-within:border-primary/30 transition-all max-w-xs">
                  <Search className="h-3.5 w-3.5 text-white/30 shrink-0" />
                  <input
                    type="text"
                    value={chQuery}
                    onChange={(e) => setChQuery(e.target.value)}
                    placeholder="Filter chapters…"
                    className="flex-1 bg-transparent border-none outline-none text-xs text-white placeholder:text-white/30"
                  />
                  {chQuery && (
                    <button onClick={() => setChQuery('')} className="text-white/40 hover:text-white/80">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}              {/* Chapters */}
          {/* ── atsu.moe (primary) ── */}
          {hasAtsuSource && (atsuChaptersQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
            </div>
          ) : (
            <div className={hasMdChapters ? 'space-y-3 pb-4 border-b border-white/[0.04]' : 'space-y-3'}>
              <h4 className="text-[10px] font-semibold text-emerald-400/60 uppercase tracking-wider flex items-center gap-2">
                <span>atsu.moe</span>
                <span className="text-white/20">·</span>
                <span>{atsuChapters.length} chapter{atsuChapters.length !== 1 ? 's' : ''}</span>
              </h4>
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                {(chQuery ? filteredAtsuChapters : atsuChapters).map((ch) => {
                  const params = new URLSearchParams()
                  params.set('manga', resolvedAtsuId!)
                  params.set('source', 'atsu')
                  if (trackMalId) params.set('malId', String(trackMalId))
                  const isColored = effectiveAtsuColoredSet.has(ch.chapter)
                  const isGrayed = coloredMode && !isColored
                  const link = `/manga/read/${ch.id}?${params.toString()}`
                  return (
                    <Link
                      key={ch.id}
                      to={isGrayed ? '#' : link}
                      onClick={isGrayed ? (e) => e.preventDefault() : undefined}
                      title={isGrayed ? 'No colored version available for this chapter' : undefined}
                      data-chapter-id={ch.id}
                      data-chapter-num={ch.chapter}
                      className={cn(
                        'flex flex-col gap-0.5 px-3 py-2.5 rounded-lg text-xs text-left transition-all border',
                        isGrayed
                          ? 'bg-white/[0.01] border-white/[0.03] opacity-40 cursor-not-allowed'
                          : 'bg-white/[0.02] border-emerald-500/10 hover:bg-emerald-500/[0.06] hover:border-emerald-500/25',
                      )}
                    >
                      <span className={cn('font-semibold truncate', isGrayed ? 'text-white/30' : 'text-white/90')}>
                        Ch. {ch.chapter}
                      </span>
                      {ch.title && (
                        <span className="text-[10px] text-white/40 truncate">{ch.title}</span>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        {ch.scanGroup && (
                          <span className="glass-pill text-emerald-400/80 border-emerald-500/20 bg-emerald-500/10">{ch.scanGroup}</span>
                        )}
                        {isColored && (
                          <span className="glass-pill text-amber-400 border-amber-500/20 bg-amber-500/10">🎨 Colored</span>
                        )}
                        {ch.pageCount > 0 && (
                          <span className="glass-pill ml-auto">{ch.pageCount}p</span>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
          {/* ── MangaDex (secondary) ── */}
          {chaptersQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 text-primary animate-spin" />
            </div>
          ) : !hasMdChapters && !hasAtsuSource ? (
            <div className="py-16 text-center glass-card rounded-xl px-8">
              <BookOpen className="h-10 w-10 text-white/10 mx-auto mb-3" />
              <p className="text-sm text-white/50 font-medium mb-1">No chapters found</p>
              <p className="text-xs text-white/30 max-w-sm mx-auto leading-relaxed">
                We couldn't find chapters for this manga on MangaDex or atsu.moe. This can happen if the manga is licensed or recently added. Try searching on MangaDex directly or check back later.
              </p>
              {!isMangaDex && (resolved?.parentTitle || resolved?.displayTitle) && (
                <a
                  href={`https://mangadex.org/search?q=${encodeURIComponent(resolved?.parentTitle || resolved?.displayTitle || '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 text-primary text-xs font-semibold hover:bg-primary/15 transition-colors"
                >
                  <Search className="h-3 w-3" />
                  Search on MangaDex
                </a>
              )}
            </div>
          ) : hasMdChapters && chQuery && filteredChapters.length === 0 && !(chQuery && filteredAtsuChapters.length > 0) ? (
            <div className="py-12 text-center">
              <Search className="h-8 w-8 text-white/10 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No chapters match "{chQuery}"</p>
              <button onClick={() => setChQuery('')} className="text-xs text-primary hover:underline mt-1">
                Clear filter
              </button>
            </div>
          ) : hasMdChapters ? (
            <div className={hasAtsuSource ? 'space-y-3 pt-4' : 'space-y-6'}>
              <h4 className="text-[10px] font-semibold text-primary/50 uppercase tracking-wider mb-2">
                MangaDex
                {mdMangaPlusCount > 0 && <span className="font-normal text-white/25 ml-1">({mdMangaPlusCount} MangaPlus hidden)</span>}
              </h4>
              {volumeGroups.length > 1 ? (
                volumeGroups.map(([vol, chs]) => (
                  <div key={vol}>
                    <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2 sticky top-20 bg-background/80 py-1">
                      {vol === 'Unknown' ? 'No Volume' : `Volume ${vol}`}
                    </h3>
                    <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                      {chs.map((ch) => {
                        const chNum = parseFloat(ch.chapter)
                        return (
                          <ChapterButton
                            key={ch.id}
                            chapter={ch}
                            mangaId={resolvedMdId || mangaId}
                            malId={trackMalId}
                            isRead={trackMalId && !isNaN(chNum) ? isChapterRead(trackMalId, chNum) : undefined}
                            isColored={mdColoredSet.has(ch.chapter)}
                            coloredMode={coloredMode}
                            source="mangadex"
                          />
                        )
                      })}
                    </div>
                  </div>
                ))
              ) : (
                <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
                  {(chQuery ? filteredChapters : mdChapters).map((ch) => {
                    const chNum = parseFloat(ch.chapter)
                    return (
                      <ChapterButton
                        key={ch.id}
                        chapter={ch}
                        mangaId={resolvedMdId || mangaId}
                        malId={trackMalId}
                        isRead={trackMalId && !isNaN(chNum) ? isChapterRead(trackMalId, chNum) : undefined}
                        isColored={mdColoredSet.has(ch.chapter)}
                        coloredMode={coloredMode}
                        source="mangadex"
                      />
                    )
                  })}
                </div>
              )}
            </div>
          ) : null}

          {/* ── MangaDex chapters (secondary source) ── */}
        </div>
      </div>
    </div>
  )
}

/** Per-manga reader override panel — lets users set default direction and
 *  reading mode for a specific manga, stored in the reader settings. */
function ReaderOverridePanel({ malId }: { malId: number }) {
  const store = useReaderStore()
  const currentDir = store.directionOverride[malId]
  const currentMode = store.readModeOverride[malId]
  const hasOverride = currentDir || currentMode

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <h3 className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-2">
        <span className="kicker-bar" />
        Reading Preferences
      </h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/60">Direction</span>
          <PillSegmented<ReadingDir>
            value={currentDir || store.readingDir}
            options={[
              { value: 'ltr', label: 'LTR' },
              { value: 'rtl', label: 'RTL' },
              { value: 'ttb', label: 'TTB' },
            ]}
            onChange={(v) => store.setDirectionOverride(malId, v)}
            size="xs"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-white/60">Reading Mode</span>
          <PillSegmented<ReadMode>
            value={currentMode || store.readMode}
            options={[
              { value: 'strip', label: 'Strip' },
              { value: 'page', label: 'Page' },
            ]}
            onChange={(v) => store.setReadModeOverride(malId, v)}
            size="xs"
          />
        </div>
        {hasOverride && (
          <button
            onClick={() => store.clearMangaOverrides(malId)}
            className="text-[10px] text-white/25 hover:text-white/50 transition-colors"
          >
            Reset to defaults
          </button>
        )}
      </div>
    </div>
  )
}

function ChapterButton({ chapter, mangaId, malId, isRead, isColored, coloredMode, source }: { chapter: MangaDexChapter; mangaId: string; malId?: number | null; isRead?: boolean; isColored?: boolean; coloredMode?: boolean; source?: string }) {
  const params = new URLSearchParams()
  params.set('manga', mangaId)
  if (malId) params.set('malId', String(malId))
  if (source) params.set('source', source)

  const isGrayed = coloredMode && !isColored
  const link = `/manga/read/${chapter.id}?${params.toString()}`
  const sharedClass = cn(
    'flex flex-col gap-0.5 px-3 py-2.5 rounded-lg text-xs text-left transition-all border',
    isGrayed
      ? 'bg-white/[0.01] border-white/[0.03] opacity-40 cursor-not-allowed'
      : isRead
        ? 'bg-emerald-500/8 border-emerald-500/15 hover:bg-emerald-500/12'
        : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.06] hover:border-white/12',
  )

  if (isGrayed) {
    return (
      <div className={sharedClass} title="No colored version available for this chapter" data-chapter-id={chapter.id} data-chapter-num={chapter.chapter}>
        <span className="font-semibold truncate text-white/30">Ch. {chapter.chapter}</span>
        {chapter.title && <span className="text-[10px] text-white/40 truncate">{chapter.title}</span>}
        <div className="flex items-center gap-2 mt-1">
          {isRead && <span className="text-[9px] text-emerald-400 font-semibold">✓ Read</span>}
          {chapter.scanGroup && <span className="text-[9px] text-primary/60 truncate">{chapter.scanGroup}</span>}
          {chapter.pages > 0 && <span className="text-[9px] text-white/30 ml-auto">{chapter.pages}p</span>}
        </div>
      </div>
    )
  }

  return (
    <Link to={link} className={sharedClass} data-chapter-id={chapter.id} data-chapter-num={chapter.chapter}>
      <span className={cn('font-semibold truncate', isRead ? 'text-emerald-400/80' : 'text-white/90')}>
        Ch. {chapter.chapter}
      </span>
      {chapter.title && (
        <span className="text-[10px] text-white/40 truncate">{chapter.title}</span>
      )}
      <div className="flex items-center gap-2 mt-1">
        {isRead && <span className="text-[9px] text-emerald-400 font-semibold">✓ Read</span>}
        {isColored && (
          <span className="text-[9px] text-amber-400 font-semibold">🎨</span>
        )}
        {chapter.scanGroup && (
          <span className="text-[9px] text-primary/60 truncate">{chapter.scanGroup}</span>
        )}
        {chapter.pages > 0 && (
          <span className="text-[9px] text-white/30 ml-auto">{chapter.pages}p</span>
        )}
      </div>
    </Link>
  )
}
