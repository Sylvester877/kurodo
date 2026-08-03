import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Filter, ChevronDown, SlidersHorizontal, Compass, Loader2, Check,
  Flame, TrendingUp, Rocket, Star, BookOpen,
} from 'lucide-react'
import {
  getAnimeGenres, getAnimeByGenre, getTopAnime, getSeasonalAnime,
  getUpcomingAnime, getPopularAnime,
} from '../api/anime'

import { useTitle } from '../hooks/useTitle'
import { cn, getBackendOrigin } from '../lib/utils'
import { browseManga as browseMangaDex, type MangaDexManga } from '../api/mangadex'
import ScrollReveal from '../components/ScrollReveal'
import SubDubToggle, { filterBySubDub } from '../components/SubDubToggle'
import { SkeletonRow } from '../components/Skeleton'
import VirtualizedAnimeGrid from '../components/VirtualizedAnimeGrid'
import { useSettings } from '../store/useSettings'
import type { Genre } from '../types'

type FilterType = 'top-rated' | 'seasonal' | 'upcoming' | 'popular' | 'genre'

const FILTER_META: Record<Exclude<FilterType, 'genre'>, {
  label: string
  subtitle: string
  icon: typeof Star
}> = {
  'top-rated': { label: 'Top Rated',  subtitle: 'Highest scored by the community',     icon: Star },
  'popular':   { label: 'Popular',     subtitle: 'Most viewed by the community',     icon: Flame },
  'seasonal':  { label: 'This Season', subtitle: 'Currently airing favorites',       icon: TrendingUp },
  'upcoming':  { label: 'Upcoming',    subtitle: 'Highly anticipated releases',      icon: Rocket },
}

const filterEntries = Object.entries(FILTER_META) as [keyof typeof FILTER_META, typeof FILTER_META['top-rated']][]

export default function Browse() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showFilters, setShowFilters] = useState(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const genreMenuRef = useRef<HTMLDivElement>(null)

  const activeFilter = (searchParams.get('filter') as FilterType) || 'top-rated'
  const activeGenreId = searchParams.get('genreId') ? Number(searchParams.get('genreId')) : null
  const contentType = (searchParams.get('type') || 'anime') as 'anime' | 'manga'

  useTitle('Catalog')

  // ───── Genres (small list, cached aggressively) ─────
  const genresQuery = useQuery({
    queryKey: ['genres'],
    queryFn: getAnimeGenres,
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })
  const genres: Genre[] = genresQuery.data?.data ?? []
  const activeGenre = useMemo(
    () => (activeGenreId ? genres.find((g) => g.mal_id === activeGenreId) : null),
    [genres, activeGenreId],
  )

  // ───── Anime list (infinite scroll via React Query) ─────
  // Key includes filter + genre so switching either starts a fresh paginated
  // sequence (with its own cache).
  const listQuery = useInfiniteQuery({
    queryKey: ['browse', activeFilter, activeGenreId],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const p = pageParam as number
      if (activeGenreId && activeFilter === 'genre') {
        return getAnimeByGenre(activeGenreId, p, 24)
      }
      switch (activeFilter) {
        case 'top-rated': return getTopAnime(p, 24)
        case 'seasonal':  return getSeasonalAnime(undefined, undefined, p, 24)
        case 'upcoming':  return getUpcomingAnime(p, 24)
        case 'popular':   return getPopularAnime(p, 24)
        default:          return getTopAnime(p, 24)
      }
    },
    getNextPageParam: (last) =>
      last.pagination.has_next_page
        ? last.pagination.current_page + 1
        : undefined,
    staleTime: 15 * 60 * 1000,
    meta: { persist: true },
  })

  const subDubFilter = useSettings((s) => s.subDubFilter)
  const browseAnime = useMemo(
    () => filterBySubDub(
      (listQuery.data?.pages ?? []).flatMap((p) => p.data),
      subDubFilter,
    ),
    [listQuery.data, subDubFilter],
  )
  const loading = listQuery.isLoading
  const loadingMore = listQuery.isFetchingNextPage

  // ───── Manga browse (MangaDex) — only when manga tab is active ─────
  const mangaQuery = useInfiniteQuery({
    queryKey: ['browse-manga'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => browseMangaDex({ sort: 'popular', limit: 24, offset: pageParam as number }),
    getNextPageParam: (last) =>
      last.results.length === last.limit ? last.offset + last.limit : undefined,
    enabled: contentType === 'manga',
    staleTime: 5 * 60 * 1000,
  })
  const browseManga = useMemo(
    () => (mangaQuery.data?.pages ?? []).flatMap((p) => p.results),
    [mangaQuery.data],
  )
  const mangaLoading = mangaQuery.isLoading
  const mangaLoadingMore = mangaQuery.isFetchingNextPage

  // Close genre dropdown when clicking outside
  useEffect(() => {
    if (!showFilters) return
    const onClick = (e: MouseEvent) => {
      if (!genreMenuRef.current?.contains(e.target as Node)) setShowFilters(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [showFilters])

  // Infinite-scroll observer — manga
  useEffect(() => {
    if (contentType !== 'manga') return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting &&
            mangaQuery.hasNextPage &&
            !mangaQuery.isFetchingNextPage) {
          void mangaQuery.fetchNextPage()
        }
      },
      { threshold: 0.1 },
    )
    if (loadMoreRef.current) obs.observe(loadMoreRef.current)
    return () => obs.disconnect()
  }, [mangaQuery.hasNextPage, mangaQuery.isFetchingNextPage, contentType])

  const updateContentType = (t: 'anime' | 'manga') => {
    const params = new URLSearchParams(searchParams)
    if (t === 'manga') params.set('type', 'manga')
    else params.delete('type')
    setSearchParams(params)
  }

  const updateFilter = (filter: FilterType) => {
    const params = new URLSearchParams(searchParams)
    params.set('filter', filter)
    params.delete('genreId')
    setSearchParams(params)
  }

  const updateGenre = (genre: Genre | null) => {
    const params = new URLSearchParams(searchParams)
    if (genre) {
      params.set('filter', 'genre')
      params.set('genreId', String(genre.mal_id))
    } else {
      params.set('filter', 'top-rated')
      params.delete('genreId')
    }
    setSearchParams(params)
    setShowFilters(false)
  }

  const handleAnimeScroll = useCallback(() => {
    if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
      void listQuery.fetchNextPage()
    }
  }, [listQuery.hasNextPage, listQuery.isFetchingNextPage])

  const activeMeta = !activeGenreId && activeFilter !== 'genre'
    ? FILTER_META[activeFilter as keyof typeof FILTER_META]
    : null
  const HeaderIcon = activeGenre ? Compass : activeMeta?.icon ?? Star
  const headerTitle = activeGenre ? activeGenre.name : activeMeta?.label ?? 'Browse'
  const headerSubtitle = activeGenre
    ? `${activeGenre.count.toLocaleString()} titles in this genre`
    : activeMeta?.subtitle ?? 'Discover your next favorite anime'

  return (
    <div className="pt-20 pb-12">
      <div className="max-w-[1600px] mx-auto px-4">
        {/* ───── Header card ───── */}
        <ScrollReveal>
        <div className="glass-card rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center">
              <HeaderIcon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white leading-tight">
                {activeGenre ? headerTitle : (activeFilter === 'top-rated' ? 'Catalog' : headerTitle)}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">{headerSubtitle}</p>
            </div>
          </div>

          {/* Content type toggle — Anime | Manga */}
          <div className="flex items-center gap-1 mb-3">
            <button
              onClick={() => updateContentType('anime')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5',
                contentType === 'anime'
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'bg-white/[0.02] text-white/45 border-transparent hover:text-white/80',
              )}
            >
              <Star className="h-3.5 w-3.5" />
              Anime
            </button>
            <button
              onClick={() => updateContentType('manga')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5',
                contentType === 'manga'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-white/[0.02] text-white/45 border-transparent hover:text-white/80',
              )}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Manga
            </button>
          </div>

          {/* Filter pills + genre menu (anime only) */}
          {contentType === 'anime' && (
          <div className="flex items-center gap-2 flex-wrap">
            {filterEntries.map(([value, meta]) => {
              const Icon = meta.icon
              const isActive = activeFilter === value && !activeGenreId
              return (
                <button
                  key={value}
                  onClick={() => updateFilter(value)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                    isActive
                      ? 'bg-primary text-white border-primary shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.5)]'
                      : 'bg-white/[0.04] text-white/70 border-white/8 hover:bg-white/[0.08] hover:text-white',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </button>
              )
            })}

            <div ref={genreMenuRef} className="relative">
              <button
                onClick={() => setShowFilters((s) => !s)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
                  activeGenreId
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white/[0.04] text-white/70 border-white/8 hover:bg-white/[0.08] hover:text-white',
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {activeGenre ? activeGenre.name : 'Genre'}
                <ChevronDown className={cn(
                  'h-3.5 w-3.5 transition-transform',
                  showFilters && 'rotate-180',
                )} />
              </button>
              {showFilters && (
                <div data-lenis-prevent className="absolute top-full mt-2 left-0 z-50 min-w-[260px] max-h-[420px] overflow-y-auto custom-scrollbar glass-card rounded-xl p-2 shadow-2xl">
                  <button
                    onClick={() => updateGenre(null)}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-colors',
                      !activeGenreId
                        ? 'bg-primary/15 text-primary'
                        : 'text-white/70 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <span>All genres</span>
                    {!activeGenreId && <Check className="h-3.5 w-3.5" />}
                  </button>
                  <div className="border-t border-white/5 my-1" />
                  {genres.map((g) => {
                    const isActive = activeGenreId === g.mal_id
                    return (
                      <button
                        key={g.mal_id}
                        onClick={() => updateGenre(g)}
                        className={cn(
                          'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs transition-colors',
                          isActive
                            ? 'bg-primary/15 text-primary font-semibold'
                            : 'text-white/70 hover:bg-white/5 hover:text-white',
                        )}
                      >
                        <span>{g.name}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {g.count.toLocaleString()}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="ml-auto flex items-center gap-3">
              <SubDubToggle />
              {browseAnime.length > 0 && (
                <span className="hidden sm:flex glass-pill">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/80" />
                  {browseAnime.length.toLocaleString()} titles
                </span>
              )}
            </div>
          </div>
          )}
        </div>
        </ScrollReveal>

        {/* ───── Manga Results ───── */}
        {contentType === 'manga' && (
          <>
            {mangaLoading && browseManga.length === 0 ? (
              <SkeletonRow count={18} />
            ) : browseManga.length === 0 ? (
              <div className="glass-card rounded-2xl py-20 text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
                <p className="text-white/80 font-semibold mb-1">No manga found</p>
                <p className="text-xs text-muted-foreground">Try browsing /manga for more options</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-6">
                  {browseManga.map((mdx: MangaDexManga) => (
                    <Link
                      key={mdx.id}
                      to={`/manga/${mdx.id}`}
                      className="group flex flex-col gap-2"
                    >
                      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-card border border-white/10 group-hover:border-emerald-500/40 transition-colors">
                        {mdx.coverUrl ? (
                          <img src={`${getBackendOrigin()}/img?url=${encodeURIComponent(mdx.coverUrl)}`} alt="" loading="lazy" decoding="async"
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="h-full w-full grid place-items-center bg-gradient-to-br from-emerald-500/10 to-transparent">
                            <BookOpen className="h-10 w-10 text-white/10" />
                          </div>
                        )}
                        {mdx.contentRating && mdx.contentRating !== 'safe' && (
                          <span className="absolute top-2 right-2 text-[8px] font-bold uppercase bg-black/75 px-1.5 py-0.5 rounded">
                            {mdx.contentRating}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-white group-hover:text-emerald-400 transition-colors line-clamp-2">
                          {mdx.title}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                          {mdx.status && <span className="capitalize">{mdx.status}</span>}
                          {mdx.year && <span>&middot; {mdx.year}</span>}
                          {mdx.lastChapter && <span>&middot; ch {mdx.lastChapter}</span>}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>

                <div ref={loadMoreRef} className="flex justify-center py-10">
                  {mangaLoadingMore ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wider">
                        Loading more manga…
                      </span>
                    </div>
                  ) : !mangaQuery.hasNextPage && browseManga.length > 0 ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="h-px w-10 bg-white/[0.06]" />
                      <span className="text-[10px] uppercase tracking-wider font-semibold">
                        All caught up · {browseManga.length.toLocaleString()} titles
                      </span>
                      <div className="h-px w-10 bg-white/[0.06]" />
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </>
        )}

        {/* ───── Anime Results ───── */}
        {contentType === 'anime' && (
          <>
        {loading && browseAnime.length === 0 ? (
          <SkeletonRow count={18} />
        ) : browseAnime.length === 0 ? (
          <div className="glass-card rounded-2xl py-20 text-center">
            <Filter className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
            <p className="text-white/80 font-semibold mb-1">No anime found</p>
            <p className="text-xs text-muted-foreground">Try a different filter or genre</p>
          </div>
        ) : (
          <VirtualizedAnimeGrid
            animes={browseAnime}
            onEndReached={handleAnimeScroll}
            isLoadingMore={loadingMore}
            hasNextPage={!!listQuery.hasNextPage}
            magnetic
            quickActions
          />
        )}
        </>
        )}
      </div>
    </div>
  )
}
