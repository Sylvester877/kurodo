import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Search as SearchIcon, X, Loader2, Sparkles, Frown, Clock, Trash2, Star, BookOpen,
} from 'lucide-react'
import { searchAnime, getAnimeGenres, type SearchFilters as Filters } from '../api/anime'
import { searchMangaAniListPaginated, type MangaSearchResult } from '../api/anilistManga'
import { searchManga as searchMangaDex, type MangaDexManga } from '../api/mangadex'
import { useDebounce } from '../hooks/useDebounce'
import { useTitle } from '../hooks/useTitle'
import {
  loadRecentSearches, pushRecentSearch, removeRecentSearch, clearRecentSearches,
} from '../lib/recentSearches'
import { useSettings } from '../store/useSettings'
import { SkeletonRow } from '../components/Skeleton'
import SearchFilters from '../components/SearchFilters'
import VirtualizedAnimeGrid from '../components/VirtualizedAnimeGrid'
import { getImageUrl, cn, getBackendOrigin } from '../lib/utils'
import ScrollReveal from '../components/ScrollReveal'
import type { Genre } from '../types'
import ErrorBoundary from '../components/ErrorBoundary'

const SUGGESTIONS = [
  'One Piece', 'Attack on Titan', 'Demon Slayer',
  'Jujutsu Kaisen', 'Spy x Family', 'Chainsaw Man',
  'Frieren', 'Death Note', 'Dandadan', 'Vinland Saga',
]

// ─────────────────────────────────────────────────────────────────
// URL ↔ filters serialization
// ─────────────────────────────────────────────────────────────────
function readFiltersFromUrl(p: URLSearchParams): Filters {
  const genres = p.get('genres')
  return {
    format:   p.get('type') || null,
    status:   p.get('status') || null,
    genres:   genres ? genres.split(',').map(Number).filter(Boolean) : null,
    minScore: p.get('min_score') ? Number(p.get('min_score')) : null,
    yearFrom: p.get('from') ? Number(p.get('from')) : null,
    yearTo:   p.get('to')   ? Number(p.get('to'))   : null,
    orderBy:  p.get('order') || null,
    sort:     (p.get('sort') as 'asc' | 'desc') || null,
  }
}

function writeFiltersToUrl(f: Filters, p: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(p)
  const setOrDel = (key: string, val: string | null | undefined) => {
    if (val == null || val === '') next.delete(key)
    else next.set(key, val)
  }
  setOrDel('type',      f.format)
  setOrDel('status',    f.status)
  setOrDel('genres',    f.genres && f.genres.length ? f.genres.join(',') : null)
  setOrDel('min_score', f.minScore?.toString() ?? null)
  setOrDel('from',      f.yearFrom?.toString() ?? null)
  setOrDel('to',        f.yearTo?.toString() ?? null)
  setOrDel('order',     f.orderBy)
  setOrDel('sort',      f.sort)
  return next
}

function hasActiveFilters(f: Filters): boolean {
  return !!(
    f.format || f.status ||
    (f.genres && f.genres.length) ||
    f.minScore || f.yearFrom || f.yearTo ||
    (f.orderBy && f.orderBy !== 'score') ||
    (f.sort && f.sort !== 'desc')
  )
}

function SearchPageContent() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const tabParam = (searchParams.get('type') || 'anime') as 'anime' | 'manga'
  const showNsfw = useSettings((s) => s.showNsfw)

  const [query, setQuery] = useState(initialQuery)
  const [activeTab, setActiveTab] = useState<'anime' | 'manga'>(tabParam)
  const [filters, setFilters] = useState<Filters>(() =>
    readFiltersFromUrl(searchParams),
  )
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches())
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const mangaLoadMoreRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const debouncedQuery = useDebounce(query, 500)
  useTitle(query ? `Search: ${query}` : 'Search')

  // Mirror NSFW setting into filters.sfw
  const effectiveFilters = useMemo<Filters>(
    () => ({ ...filters, sfw: !showNsfw }),
    [filters, showNsfw],
  )

  // ───── Anime Query ─────
  const trimmed = debouncedQuery.trim()
  const listQuery = useInfiniteQuery({
    queryKey: ['search', trimmed, effectiveFilters],
    enabled: activeTab === 'anime' && (trimmed.length >= 2 || hasActiveFilters(filters)),
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      searchAnime(trimmed || '', pageParam as number, 24, effectiveFilters),
    getNextPageParam: (last) =>
      last.pagination.has_next_page
        ? last.pagination.current_page + 1
        : undefined,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  })

  const searchResults = useMemo(
    () => (listQuery.data?.pages ?? []).flatMap((p) => p?.data ?? []),
    [listQuery.data],
  )
  const totalResults = listQuery.data?.pages?.[0]?.pagination?.items?.total ?? null
  const loading = listQuery.isLoading
  const loadingMore = listQuery.isFetchingNextPage
  const error = listQuery.isError

  // ───── Manga infinite query ─────
  const mangaQuery = useInfiniteQuery({
    queryKey: ['manga-search-page', trimmed],
    enabled: trimmed.length >= 2,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      searchMangaAniListPaginated(trimmed, pageParam as number, 24),
    getNextPageParam: (last: MangaSearchResult) =>
      last.pagination.has_next_page
        ? last.pagination.current_page + 1
        : undefined,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  })
  const mangaResults = useMemo(
    () => (mangaQuery.data?.pages ?? []).flatMap((p) => p?.data ?? []),
    [mangaQuery.data],
  )
  const mangaTotalResults = mangaQuery.data?.pages?.[0]?.pagination?.items?.total ?? null
  const mangaLoading = mangaQuery.isLoading
  const mangaLoadingMore = mangaQuery.isFetchingNextPage
  const mangaError = mangaQuery.isError

  // ───── MangaDex Colour query (parallel fetch for colored editions) ─────
  const colourQuery = useQuery({
    queryKey: ['manga-search-colour', trimmed],
    queryFn: () => searchMangaDex(trimmed + ' Color', 6, 0),
    enabled: trimmed.length >= 2 && activeTab === 'manga',
    staleTime: 5 * 60 * 1000,
    retry: 0,
  })
  const colourRaw = colourQuery.data?.results ?? []

  // Merge OG (AniList) + Colour (MangaDex) results with deduplication
  const mergedManga = useMemo(() => {
    const og = mangaResults
    const colour = colourRaw

    // Only keep colour entries where title contains both the original query
    // AND "Color"/"Colored" — prevents unrelated manga from appearing
    const qLower = trimmed.toLowerCase()
    const colourValid = colour.filter((r: MangaDexManga) =>
      /color|coloured|colored/i.test(r.title) &&
      r.title.toLowerCase().includes(qLower),
    )

    // Build dedup set from OG titles
    const ogTitlesLower = new Set(
      og.map((m) => (m.title.english || m.title.romaji || '').toLowerCase()),
    )
    const colourUnique = colourValid.filter(
      (r) => !ogTitlesLower.has(r.title.toLowerCase()),
    )

    // Filter OG entries that are themselves colored variants (already captured above)
    const ogFiltered = og.filter((m) => {
      const t = (m.title.english || m.title.romaji || '').toLowerCase()
      return !/color|coloured|colored/i.test(t)
    })

    return { og: ogFiltered, colour: colourUnique }
  }, [mangaResults, colourRaw])

  // Active tab switch handler
  const setTab = useCallback((tab: 'anime' | 'manga') => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    if (tab === 'manga') next.set('type', 'manga')
    else next.delete('type')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  // ───── URL sync (query + filters) ─────
  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    if (debouncedQuery) params.set('q', debouncedQuery)
    else params.delete('q')
    const next = writeFiltersToUrl(filters, params)
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
    // Synchronise query + filters into the URL bar. We deliberately omit
    // setSearchParams from the dep array — React Router's setter identity
    // is stable, but including searchParams would create a feedback loop
    // (setSearchParams → new URL → triggers this effect → …).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, filters])

  // ───── Recent searches: record when a query "settles" ─────
  useEffect(() => {
    if (!trimmed || trimmed.length < 2) return
    if (!listQuery.isSuccess && !mangaQuery.isSuccess) return
    const next = pushRecentSearch(trimmed)
    setRecent(next)
    // Record the settled query into recent searches. We intentionally
    // use the isSuccess booleans as a "settled" signal rather than the
    // full query object (which would trigger needless re-runs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, listQuery.isSuccess, mangaQuery.isSuccess])

  // ═══ Memoized callbacks for virtualized grid (stable references prevent
  // child re-renders on every debounce tick) ═══
  const handleAnimeScroll = useCallback(() => {
    if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
      void listQuery.fetchNextPage()
    }
  }, [listQuery.hasNextPage, listQuery.isFetchingNextPage])
  // The mobile grid uses VirtualizedAnimeGrid which handles its own infinite scroll.
  // Desktop horizontal list cards still use IntersectionObserver via loadMoreRef.
  useEffect(() => {
    if (activeTab !== 'anime') return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting &&
            listQuery.hasNextPage &&
            !listQuery.isFetchingNextPage) {
          void listQuery.fetchNextPage()
        }
      },
      { threshold: 0.1 },
    )
    if (loadMoreRef.current) obs.observe(loadMoreRef.current)
    return () => obs.disconnect()
  }, [listQuery.hasNextPage, listQuery.isFetchingNextPage, activeTab])

  // ───── Infinite-scroll observer (manga) ─────
  useEffect(() => {
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
    if (mangaLoadMoreRef.current) obs.observe(mangaLoadMoreRef.current)
    return () => obs.disconnect()
  }, [mangaQuery])

  // "/" focuses the search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement)?.matches('input, textarea')) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const removeRecent = useCallback((q: string) => {
    setRecent(removeRecentSearch(q))
  }, [])
  const clearAllRecent = useCallback(() => {
    clearRecentSearches()
    setRecent([])
  }, [])

  const filtersActive = hasActiveFilters(filters)
  const idle = !trimmed && !filtersActive
  const showSuggestions = idle && activeTab === 'anime'
  const showResults = searchResults.length > 0
  const showEmpty =
    (trimmed || filtersActive) && !loading && !error && searchResults.length === 0

  return (
    <ErrorBoundary scope="Search">
    <div className="pt-20 pb-12">
      <div className="max-w-[1600px] mx-auto px-4">
        {/* ───── Header ───── */}
        <ScrollReveal>
        <div className="relative rounded-2xl overflow-hidden mb-5">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent pointer-events-none" />
          <div className="glass-card rounded-2xl p-5 relative">
            <div className="flex items-start gap-4 mb-4">
              <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center shrink-0">
                <SearchIcon className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="kicker-bar" />
                  <h1 className="text-2xl font-extrabold text-white leading-tight">Search</h1>
                </div>
                <p className="text-xs text-muted-foreground">
                  Find {activeTab === 'manga' ? 'manga & manhwa' : 'anime'} by title · press{' '}
                  <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-white/10 border border-white/15">/</kbd>
                  {' '}to focus
                </p>
              </div>
            </div>

            {/* Search input */}
            <div className="flex items-center gap-3 rounded-xl border-2 border-white/10 bg-black/40 px-4 py-3 focus-within:border-primary/60 focus-within:bg-black/60 focus-within:shadow-[0_0_30px_-8px_hsl(245,75%,60%,0.35)] transition-all">
              <SearchIcon className="h-5 w-5 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by title… try 'Attack on Titan' (or use filters below)"
                className="bg-transparent border-none outline-none text-base w-full text-white placeholder:text-muted-foreground"
                autoFocus
                spellCheck={false}
              />
              {query && (
                <button
                  onClick={() => { setQuery(''); inputRef.current?.focus() }}
                  aria-label="Clear search"
                  className="text-muted-foreground hover:text-white transition-colors p-1 rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {loading && (
                <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              )}
            </div>

            {/* Mobile filter bar — visible below lg (anime only) */}
            {activeTab === 'anime' && (
              <div className="mt-4 lg:hidden">
                <SearchFilters value={filters} onChange={setFilters} />
              </div>
            )}
          </div>
        </div>
        </ScrollReveal>

        {/* ───── Sidebar + Content grid ───── */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 items-start">
          {/* ── Desktop filter sidebar (anime only) ── */}
          {activeTab === 'anime' && (
            <aside className="hidden lg:block lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto custom-scrollbar space-y-4">
              <FilterSidebar filters={filters} onChange={setFilters} />
            </aside>
          )}

          {/* ── Main content ── */}
          <div className="min-w-0">

            {/* ───── Tabs ───── */}
            {(trimmed || filtersActive) && (
              <div className="flex items-center gap-1 mb-4">
                <button
                  onClick={() => setTab('anime')}
                  className={cn(
                    'px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5',
                    activeTab === 'anime'
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-white/[0.02] text-white/45 border-transparent hover:text-white/80',
                  )}
                >
                  <SearchIcon className="h-3.5 w-3.5" />
                  Anime
                  {activeTab === 'anime' && totalResults != null && (
                    <span className="text-[10px] text-primary/60">({totalResults.toLocaleString()})</span>
                  )}
                </button>
                <button
                  onClick={() => setTab('manga')}
                  className={cn(
                    'px-4 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5',
                    activeTab === 'manga'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-white/[0.02] text-white/45 border-transparent hover:text-white/80',
                  )}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Manga
                  {activeTab === 'manga' && mangaTotalResults != null && (
                    <span className="text-[10px] text-emerald-400/60">({mangaTotalResults.toLocaleString()})</span>
                  )}
                </button>
              </div>
            )}

            {activeTab === 'anime' && (
            <>
            {/* ───── Result count ───── */}
            {(showResults || (loading && (trimmed || filtersActive))) && (
              <div className="flex items-center justify-between mb-4 px-1 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="kicker-bar" />
                  <p className="text-sm text-muted-foreground">
                    {loading && searchResults.length === 0
                      ? 'Searching…'
                      : totalResults != null
                        ? <>
                            <span className="text-white font-semibold">
                              {totalResults.toLocaleString()}
                            </span> result{totalResults === 1 ? '' : 's'}
                            {trimmed && <> for <span className="text-white font-semibold">"{trimmed}"</span></>}
                          </>
                        : `${searchResults.length} loaded`}
                  </p>
                </div>
                {listQuery.hasNextPage && (
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Scroll for more
                  </p>
                )}
              </div>
            )}

            {/* ───── Body ───── */}
            {showSuggestions ? (
              <div className="space-y-5">
                {recent.length > 0 && (
                  <div className="glass-card rounded-2xl p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                          Recent searches
                        </h2>
                      </div>
                      <button
                        onClick={clearAllRecent}
                        className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        Clear all
                      </button>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {recent.map((s) => (
                        <div
                          key={s}
                          className="group flex items-center gap-1 rounded-lg bg-white/[0.04] border border-white/8 hover:bg-white/[0.08] transition-all overflow-hidden"
                        >
                          <button
                            onClick={() => setQuery(s)}
                            className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 text-xs font-medium text-white/85 hover:text-white"
                          >
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            {s}
                          </button>
                          <button
                            onClick={() => removeRecent(s)}
                            aria-label={`Remove ${s}`}
                            className="px-2 py-1.5 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="glass-card rounded-2xl p-8 text-center">
                  <Sparkles className="h-10 w-10 text-primary mx-auto mb-3 opacity-80" />
                  <h2 className="text-lg font-bold text-white mb-1">Try a search</h2>
                  <p className="text-sm text-muted-foreground mb-6">
                    Type a title above, apply filters, or pick a popular one
                  </p>
                  <div className="flex items-center justify-center gap-2 flex-wrap max-w-2xl mx-auto">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setQuery(s)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/[0.04] border border-white/8 text-white/75 hover:bg-primary/15 hover:border-primary/40 hover:text-primary hover:shadow-[0_0_16px_-6px_hsl(245,75%,60%,0.2)] transition-all"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : loading && searchResults.length === 0 ? (
              <SkeletonRow count={18} />
            ) : error ? (
              <div className="glass-card rounded-2xl py-16 text-center max-w-md mx-auto">
                <Frown className="h-10 w-10 text-red-400 mx-auto mb-3 opacity-80" />
                <p className="text-white font-semibold mb-1">Search failed</p>
                <p className="text-xs text-muted-foreground mb-5">
                  The metadata source might be rate-limited. Wait a moment and retry.
                </p>
                <button
                  onClick={() => listQuery.refetch()}
                  className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-all shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.4)] hover:shadow-[0_8px_24px_-6px_hsl(245,75%,60%,0.55)] hover:-translate-y-0.5"
                >
                  Try again
                </button>
              </div>
            ) : showEmpty ? (
              <div className="glass-card rounded-2xl py-16 text-center max-w-md mx-auto">
                <Frown className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-white font-semibold mb-1">No results</p>
                <p className="text-xs text-muted-foreground mb-5">
                  {trimmed
                    ? <>Nothing matched <span className="text-white">"{trimmed}"</span> with these filters.</>
                    : 'No anime match these filters.'}
                </p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {filtersActive && (
                    <button
                      onClick={() => setFilters({})}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 transition-all shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.4)] hover:shadow-[0_8px_24px_-6px_hsl(245,75%,60%,0.55)]"
                    >
                      Clear filters
                    </button>
                  )}
                  <Link
                    to="/browse"
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/5 text-white/80 hover:bg-white/10 border border-white/10 hover:border-primary/30 transition-all"
                  >
                    Browse all
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {/* Mobile: poster grid — virtualized for scroll performance */}
                <div className="lg:hidden">
                  <VirtualizedAnimeGrid
                    animes={searchResults}
                    onEndReached={handleAnimeScroll}
                    isLoadingMore={loadingMore}
                    hasNextPage={!!listQuery.hasNextPage}
                    magnetic
                    quickActions
                  />
                </div>

                {/* Desktop: anidap-style horizontal list cards */}
                <div className="hidden lg:block space-y-2">
                  {searchResults.map((anime) => (
                    <Link
                      key={anime.mal_id}
                      to={`/anime/${anime.mal_id}`}
                      className="group flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-primary/30 transition-all"
                    >
                      {/* Poster */}
                      <div className="relative h-[88px] w-[60px] shrink-0 rounded-lg overflow-hidden bg-card border border-white/10">
                        <img
                          src={getImageUrl(anime)}
                          alt={anime.title}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                        />
                        {anime.status === 'Currently Airing' && (
                          <div className="absolute top-1 left-1 h-2 w-2 rounded-full bg-emerald-500 animate-pulse ring-1 ring-black/40" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-bold text-white group-hover:text-primary transition-colors truncate">
                          {anime.title_english || anime.title}
                        </h3>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {anime.title !== (anime.title_english || anime.title) ? anime.title : anime.title_japanese}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="glass-pill text-[10px] py-0.5 px-1.5">
                            {anime.type}
                          </span>
                          {anime.episodes && (
                            <span className="text-[10px] text-muted-foreground">
                              {anime.episodes} ep
                            </span>
                          )}
                          {anime.year && (
                            <span className="text-[10px] text-muted-foreground">
                              &middot; {anime.year}
                            </span>
                          )}
                          {anime.status && (
                            <span className={`glass-pill text-[10px] py-0.5 px-1.5 ${
                              anime.status === 'Currently Airing'
                                ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                                : 'text-white/60'
                            }`}>
                              {anime.status === 'Currently Airing' ? 'Airing' : anime.status === 'Finished Airing' ? 'Completed' : anime.status}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Score + Rank badge */}
                      <div className="flex items-center gap-2 shrink-0">
                        {anime.score && (
                          <div className="flex items-center gap-1 rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1.5">
                            <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                            <span className="text-xs font-bold text-yellow-400 tabular-nums">{anime.score.toFixed(1)}</span>
                          </div>
                        )}
                        {anime.rank && (
                          <div className="rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1.5">
                            <span className="text-[10px] font-bold text-primary tabular-nums">#{anime.rank}</span>
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>

                <div ref={loadMoreRef} className="flex justify-center py-10">
                  {loadingMore ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span className="text-xs font-semibold uppercase tracking-wider">
                        Loading more
                      </span>
                    </div>
                  ) : !listQuery.hasNextPage && searchResults.length > 0 ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="h-px w-8 bg-white/10" />
                      <span className="text-[10px] uppercase tracking-wider font-semibold">
                        All results loaded
                      </span>
                      <div className="h-px w-8 bg-white/10" />
                    </div>
                  ) : null}
                </div>
              </>
            )}
            </>
            )}

            {/* ───── Manga Tab ───── */}
            {activeTab === 'manga' && (
            <>
              {/* Manga result count */}
              {trimmed && (
                <div className="flex items-center justify-between mb-4 px-1 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="kicker-bar" />
                    <p className="text-sm text-muted-foreground">
                      {mangaLoading && mangaResults.length === 0
                        ? 'Searching…'
                        : mangaTotalResults != null
                          ? <>
                              <span className="text-white font-semibold">
                                {mangaTotalResults.toLocaleString()}
                              </span> manga result{mangaTotalResults === 1 ? '' : 's'}
                              {trimmed && <> for <span className="text-white font-semibold">"{trimmed}"</span></>}
                            </>
                          : `${mangaResults.length} loaded`}
                    </p>
                  </div>
                  {mangaQuery.hasNextPage && (
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Scroll for more
                    </p>
                  )}
                </div>
              )}

              {mangaLoading && mergedManga.og.length === 0 ? (
                <SkeletonRow count={12} />
              ) : mangaError ? (
                <div className="glass-card rounded-2xl py-16 text-center max-w-md mx-auto">
                  <Frown className="h-10 w-10 text-red-400 mx-auto mb-3 opacity-80" />
                  <p className="text-white font-semibold mb-1">Search failed</p>
                  <p className="text-xs text-muted-foreground mb-5">
                    The AniList API might be rate-limited. Wait a moment and retry.
                  </p>
                  <button
                    onClick={() => mangaQuery.refetch()}
                    className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-all shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.4)]"
                  >
                    Try again
                  </button>
                </div>
              ) : !mangaLoading && mergedManga.og.length === 0 && mergedManga.colour.length === 0 && trimmed ? (
                <div className="glass-card rounded-2xl py-16 text-center max-w-md mx-auto">
                  <Frown className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-white font-semibold mb-1">No manga results</p>
                  <p className="text-xs text-muted-foreground mb-5">
                    Nothing matched <span className="text-white">"{trimmed}"</span> on AniList.
                  </p>
                  <Link
                    to="/manga"
                    className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/5 text-white/80 hover:bg-white/10 border border-white/10 hover:border-primary/30 transition-all inline-block"
                  >
                    Browse manga
                  </Link>
                </div>
              ) : (
                <>
                  {/* Mobile: manga grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:hidden gap-x-3 gap-y-5 contain-auto">
                    {mergedManga.og.map((manga) => {
                      const cover = manga.coverImage?.large || manga.coverImage?.extraLarge
                      const score = manga.averageScore ? (manga.averageScore / 10).toFixed(1) : null
                      const year = manga.startDate?.year || null
                      return (
                        <Link
                          key={manga.id}
                          to={`/manga/${manga.id}`}
                          className="group flex flex-col gap-2"
                        >
                          <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-card border border-white/10">
                            {cover ? (
                              <img src={cover} alt="" loading="lazy" decoding="async"
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                            ) : (
                              <div className="h-full w-full grid place-items-center">
                                <BookOpen className="h-8 w-8 text-white/10" />
                              </div>
                            )}
                            {score && (
                              <div className="absolute top-2 right-2 bg-black/75 rounded-md px-1.5 py-0.5 flex items-center gap-0.5">
                                <Star className="h-2.5 w-2.5 text-yellow-400 fill-yellow-400" />
                                <span className="text-[10px] font-bold text-white tabular-nums">{score}</span>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-white group-hover:text-emerald-400 transition-colors line-clamp-2">
                              {manga.title.english || manga.title.romaji}
                            </p>
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                              {manga.format && <span className="px-1 py-px rounded bg-emerald-500/10 text-emerald-400/80 font-semibold">{manga.format}</span>}
                              {year && <span>{year}</span>}
                              {manga.chapters != null && <span>· {manga.chapters} ch</span>}
                            </div>
                          </div>
                        </Link>
                      )
                    })}
                    {/* ── Coloured manga from MangaDex ── */}
                    {mergedManga.colour.length > 0 && (
                      <>
                        <div className="col-span-full flex items-center gap-2 my-3 first:mt-0">
                          <div className="h-px flex-1 bg-gradient-to-r from-pink-500/30 to-purple-500/30" />
                          <span className="glass-pill text-[10px] font-bold uppercase tracking-wider text-pink-300/80 bg-gradient-to-r from-pink-500/10 to-purple-500/10 border-pink-500/20">
                            Coloured Editions
                          </span>
                          <div className="h-px flex-1 bg-gradient-to-r from-purple-500/30 to-pink-500/30" />
                        </div>
                        {mergedManga.colour.map((mdx) => (
                          <Link
                            key={`colour-${mdx.id}`}
                            to={`/manga/${mdx.id}`}
                            className="group flex flex-col gap-2"
                          >
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-card border border-pink-500/20">
                              {mdx.coverUrl ? (
                                <img src={`${getBackendOrigin()}/img?url=${encodeURIComponent(mdx.coverUrl)}`} alt="" loading="lazy" decoding="async"
                                  className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                              ) : (
                                <div className="h-full w-full grid place-items-center">
                                  <BookOpen className="h-8 w-8 text-white/10" />
                                </div>
                              )}
                              <div className="absolute top-2 left-2">
                                <span className="bg-gradient-to-r from-pink-500/80 via-purple-500/80 to-cyan-500/80 text-white text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-md tracking-wider">
                                  Color
                                </span>
                              </div>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-white group-hover:text-pink-300 transition-colors line-clamp-2">
                                {mdx.title} <span className="text-pink-300/70">(Color)</span>
                              </p>
                            </div>
                          </Link>
                        ))}
                      </>
                    )}
                  </div>

                  {mergedManga.colour.length > 0 && (
                    <div className="hidden lg:flex items-center gap-3 my-3 first:mt-0">
                      <div className="h-px flex-1 bg-gradient-to-r from-pink-500/30 to-purple-500/30" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-pink-300/80 bg-gradient-to-r from-pink-500/10 to-purple-500/10 px-2 py-0.5 rounded-full border border-pink-500/20">
                        Coloured Editions
                      </span>
                      <div className="h-px flex-1 bg-gradient-to-r from-purple-500/30 to-pink-500/30" />
                    </div>
                  )}
                  {/* Desktop: manga list cards */}
                  <div className="hidden lg:block space-y-2">
                    {mergedManga.og.map((manga) => {
                      const cover = manga.coverImage?.large || manga.coverImage?.extraLarge
                      const score = manga.averageScore ? (manga.averageScore / 10).toFixed(1) : null
                      const year = manga.startDate?.year || null
                      return (
                        <Link
                          key={manga.id}
                          to={`/manga/${manga.id}`}
                          className="group flex items-center gap-4 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-emerald-500/30 transition-all"
                        >
                          <div className="relative h-[88px] w-[60px] shrink-0 rounded-lg overflow-hidden bg-card border border-white/10">
                            {cover ? (
                              <img src={cover} alt="" loading="lazy" decoding="async"
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                            ) : (
                              <div className="h-full w-full grid place-items-center">
                                <BookOpen className="h-5 w-5 text-white/10" />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors truncate">
                              {manga.title.english || manga.title.romaji}
                            </h3>
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {manga.title.english ? manga.title.romaji : manga.title.native}
                            </p>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              {manga.format && (
                                <span className="glass-pill text-[10px] py-0.5 px-1.5 text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                                  {manga.format}
                                </span>
                              )}
                              {manga.chapters != null && (
                                <span className="text-[10px] text-muted-foreground">{manga.chapters} ch</span>
                              )}
                              {year && (
                                <span className="text-[10px] text-muted-foreground">&middot; {year}</span>
                              )}
                              {manga.status && (
                                <span className="glass-pill text-[10px] py-0.5 px-1.5 text-white/60 capitalize">
                                  {manga.status.toLowerCase().replace(/_/g, ' ')}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {score && (
                              <div className="glass-pill text-amber-400 border-amber-500/25 bg-amber-500/10">
                                <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                                <span className="text-xs font-bold tabular-nums">{score}</span>
                              </div>
                            )}
                          </div>
                        </Link>
                      )
                    })}
                  </div>

                  <div ref={mangaLoadMoreRef} className="flex justify-center py-10">
                    {mangaLoadingMore ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-xs font-semibold uppercase tracking-wider">
                          Loading more manga…
                        </span>
                      </div>
                    ) : !mangaQuery.hasNextPage && mergedManga.og.length > 0 ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <div className="h-px w-8 bg-white/10" />
                        <span className="text-[10px] uppercase tracking-wider font-semibold">
                          All manga loaded
                        </span>
                        <div className="h-px w-8 bg-white/10" />
                      </div>
                    ) : null}
                  </div>

                  {/* ── Desktop: Coloured manga list cards ── */}
                  {mergedManga.colour.length > 0 && (
                    <div className="hidden lg:block space-y-2 mt-2">
                      {mergedManga.colour.map((mdx) => (
                        <Link
                          key={`colour-${mdx.id}`}
                          to={`/manga/${mdx.id}`}
                          className="group flex items-center gap-4 p-3 rounded-xl bg-gradient-to-r from-pink-500/[0.03] to-purple-500/[0.03] hover:from-pink-500/[0.06] hover:to-purple-500/[0.06] border border-pink-500/15 hover:border-pink-500/40 transition-all"
                        >
                          <div className="relative h-[88px] w-[60px] shrink-0 rounded-lg overflow-hidden bg-card border border-pink-500/20">
                            {mdx.coverUrl ? (
                              <img src={`${getBackendOrigin()}/img?url=${encodeURIComponent(mdx.coverUrl)}`} alt="" loading="lazy" decoding="async"
                                className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                            ) : (
                              <div className="h-full w-full grid place-items-center">
                                <BookOpen className="h-5 w-5 text-white/10" />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-bold text-white group-hover:text-pink-300 transition-colors truncate">
                              {mdx.title} <span className="text-pink-300/70 font-normal">(Color)</span>
                            </h3>
                            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                              <span className="glass-pill text-[8px] font-bold uppercase tracking-wider text-white bg-gradient-to-r from-pink-500/80 via-purple-500/80 to-cyan-500/80 border-transparent">
                                Color
                              </span>
                              {mdx.year && (
                                <span className="text-[10px] text-muted-foreground">{mdx.year}</span>
                              )}
                              {mdx.lastChapter && (
                                <span className="text-[10px] text-muted-foreground">&middot; ch {mdx.lastChapter}</span>
                              )}
                              {mdx.status && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white/[0.04] text-white/50 border border-white/8 capitalize">
                                  {mdx.status}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
            )}
          </div>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  )
}

// ─────────────────────────────────────────────────────────────────
// Desktop filter sidebar — renders the same filters as SearchFilters
// but in a vertical sidebar card layout for lg+ screens.
// ─────────────────────────────────────────────────────────────────

const SIDEBAR_FORMATS = [
  { value: 'tv', label: 'TV' },
  { value: 'movie', label: 'Movie' },
  { value: 'ova', label: 'OVA' },
  { value: 'special', label: 'Special' },
  { value: 'ona', label: 'ONA' },
]

const SIDEBAR_STATUSES = [
  { value: 'airing', label: 'Airing' },
  { value: 'complete', label: 'Completed' },
  { value: 'upcoming', label: 'Upcoming' },
]

const SIDEBAR_SORTS = [
  { value: 'score', label: 'Score' },
  { value: 'popularity', label: 'Popularity' },
  { value: 'start_date', label: 'Newest' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'rank', label: 'Rank' },
]

const SIDEBAR_SCORES = [
  { value: null, label: 'Any' },
  { value: 9, label: '9+' },
  { value: 8, label: '8+' },
  { value: 7, label: '7+' },
  { value: 6, label: '6+' },
]

const CURRENT_YEAR = new Date().getFullYear()

const FilterSidebar = React.memo(function FilterSidebar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const set = <K extends keyof Filters>(key: K, v: Filters[K]) => onChange({ ...filters, [key]: v })

  const genresQuery = useQuery({
    queryKey: ['genres'],
    queryFn: getAnimeGenres,
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })
  const allGenres: Genre[] = genresQuery.data?.data ?? []
  const activeGenres = filters.genres ?? []

  const activeCount = (filters.format ? 1 : 0) + (filters.status ? 1 : 0) + (activeGenres.length ? 1 : 0) + (filters.minScore ? 1 : 0) + (filters.yearFrom || filters.yearTo ? 1 : 0)

  return (
    <>
      {/* Active filters summary */}
      {activeCount > 0 && (
        <div className="glass-card rounded-xl p-3 flex items-center justify-between">
          <span className="text-xs text-white font-semibold">{activeCount} active filter{activeCount !== 1 ? 's' : ''}</span>
          <button
            onClick={() => onChange({ format: null, status: null, genres: null, minScore: null, yearFrom: null, yearTo: null, orderBy: null, sort: null, sfw: filters.sfw })}
            className="text-[10px] uppercase tracking-wider font-bold text-red-400 hover:text-red-300 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Sort */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="kicker-bar" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Sort by</h3>
        </div>
        <div className="space-y-1">
          {SIDEBAR_SORTS.map((o) => {
            const active = (filters.orderBy ?? 'score') === o.value
            return (
              <button
                key={o.value}
                onClick={() => {
                  onChange({ ...filters, orderBy: o.value, sort: filters.sort ?? 'desc' })
                }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors',
                  active ? 'bg-primary/15 text-primary font-semibold' : 'text-white/60 hover:bg-white/[0.04] hover:text-white',
                )}
              >
                {o.label}
                {active && <span className="text-[10px] text-primary/70">{filters.sort === 'asc' ? '↑' : '↓'}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Format */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="kicker-bar" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Format</h3>
        </div>
        <div className="space-y-1">
          <button
            onClick={() => set('format', null)}
            className={cn(
              'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
              !filters.format ? 'bg-primary/15 text-primary font-semibold' : 'text-white/60 hover:bg-white/[0.04] hover:text-white',
            )}
          >
            All formats
          </button>
          {SIDEBAR_FORMATS.map((f) => {
            const active = filters.format === f.value
            return (
              <button
                key={f.value}
                onClick={() => set('format', active ? null : f.value)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
                  active ? 'bg-primary/15 text-primary font-semibold' : 'text-white/60 hover:bg-white/[0.04] hover:text-white',
                )}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Status */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="kicker-bar" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Status</h3>
        </div>
        <div className="space-y-1">
          <button
            onClick={() => set('status', null)}
            className={cn(
              'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
              !filters.status ? 'bg-primary/15 text-primary font-semibold' : 'text-white/60 hover:bg-white/[0.04] hover:text-white',
            )}
          >
            Any status
          </button>
          {SIDEBAR_STATUSES.map((s) => {
            const active = filters.status === s.value
            return (
              <button
                key={s.value}
                onClick={() => set('status', active ? null : s.value)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
                  active ? 'bg-primary/15 text-primary font-semibold' : 'text-white/60 hover:bg-white/[0.04] hover:text-white',
                )}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Score */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="kicker-bar" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Min score</h3>
        </div>
        <div className="space-y-1">
          {SIDEBAR_SCORES.map((o) => {
            const active = filters.minScore === o.value
            return (
              <button
                key={String(o.value)}
                onClick={() => set('minScore', o.value)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
                  active ? 'bg-primary/15 text-primary font-semibold' : 'text-white/60 hover:bg-white/[0.04] hover:text-white',
                )}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>
      
      {/* Year */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="kicker-bar" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Year</h3>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            placeholder="1999"
            value={filters.yearFrom || ''}
            min={1940}
            max={filters.yearTo || CURRENT_YEAR + 2}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null
              set('yearFrom', val)
            }}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <input
            type="number"
            placeholder={String(CURRENT_YEAR)}
            value={filters.yearTo || ''}
            min={filters.yearFrom || 1940}
            max={CURRENT_YEAR + 2}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null
              set('yearTo', val)
            }}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* Genre */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="kicker-bar" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            Genre{activeGenres.length > 0 && ` (${activeGenres.length})`}
          </h3>
        </div>
        <div className="space-y-1 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
          {allGenres.map((g) => {
            const active = activeGenres.includes(g.mal_id)
            return (
              <button
                key={g.mal_id}
                onClick={() => {
                  if (active) {
                    const next = activeGenres.filter((id) => id !== g.mal_id)
                    set('genres', next.length ? next : null)
                  } else {
                    set('genres', [...activeGenres, g.mal_id])
                  }
                }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors',
                  active ? 'bg-primary/15 text-primary font-semibold' : 'text-white/60 hover:bg-white/[0.04] hover:text-white',
                )}
              >
                <span>{g.name}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{g.count.toLocaleString()}</span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
})

export default function SearchPage() {
  return (
    <ErrorBoundary scope="Search">
      <SearchPageContent />
    </ErrorBoundary>
  )
}
