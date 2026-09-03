import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Search as SearchIcon, X, Loader2, Sparkles, Frown, Clock, Trash2, Star, BookOpen,
  ChevronDown, ChevronUp,
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
import { cn, getBackendOrigin } from '../lib/utils'
import AnimeCard from '../components/AnimeCard'
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
    season:   p.get('season') || null,
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
  setOrDel('season',    f.season)
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
    f.format || f.season || f.status ||
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

  const debouncedQuery = useDebounce(query, 250)
  useTitle(query ? `Search: ${query}` : 'Search')

  // Mirror NSFW setting into filters.sfw — and default the sort to
  // Popularity (anikage-style): the search grid should lead with the
  // well-known entries, and the Sort dropdown's default label must be
  // truthful about it.
  const effectiveFilters = useMemo<Filters>(
    () => ({ ...filters, sfw: !showNsfw, orderBy: filters.orderBy ?? 'popularity', sort: filters.sort ?? 'desc' }),
    [filters, showNsfw],
  )

  // Genres for the quick-filter chip row — shares the ['genres'] cache with
  // FilterSidebar, so no extra network request when the sidebar already loaded.
  const quickGenresQuery = useQuery({
    queryKey: ['genres'],
    queryFn: getAnimeGenres,
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })
  const allGenres: Genre[] = quickGenresQuery.data?.data ?? []
  const toggleGenre = useCallback((id: number) => {
    setFilters((prev) => {
      const active = prev.genres ?? []
      const next = active.includes(id)
        ? active.filter((g) => g !== id)
        : [...active, id]
      return { ...prev, genres: next.length ? next : null }
    })
  }, [])

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
    placeholderData: (prev) => prev, // keep old results visible between keystrokes
  })

  const searchResults = useMemo(
    () => (listQuery.data?.pages ?? []).flatMap((p) => p?.data ?? []),
    [listQuery.data],
  )
  const totalResults = listQuery.data?.pages?.[0]?.pagination?.items?.total ?? null
  const loading = listQuery.isLoading
  const loadingMore = listQuery.isFetchingNextPage
  const error = listQuery.isError

  // ───── Manga infinite query (only when the Manga tab is active — firing
  // it on the anime tab wasted an AniList GraphQL call on every search) ─────
  const mangaQuery = useInfiniteQuery({
    queryKey: ['manga-search-page', trimmed],
    enabled: trimmed.length >= 2 && activeTab === 'manga',
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      searchMangaAniListPaginated(trimmed, pageParam as number, 24),
    getNextPageParam: (last: MangaSearchResult) =>
      last.pagination.has_next_page
        ? last.pagination.current_page + 1
        : undefined,
    staleTime: 5 * 60 * 1000,
    retry: 0,
    placeholderData: (prev) => prev,
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
    placeholderData: (prev) => prev,
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
      {/* ══════════ Compact anikage-style top bar: Search | Genres | Sort by | Year | Trash ══════════ */}
      <div className="max-w-[1600px] mx-auto px-4 mb-4">
        <div className="flex items-end gap-4 flex-wrap">
          {/* Search field with its label above — matches "Search / Genres / Sort by / Year" header row */}
          <div className="flex-[2] min-w-[280px]">
            <h1 className="text-base font-extrabold text-white mb-2">Search</h1>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 focus-within:border-primary/50 focus-within:bg-white/[0.05] transition-all">
              <SearchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search anime…"
                className="bg-transparent border-none outline-none text-sm w-full text-white placeholder:text-muted-foreground"
                autoFocus
                spellCheck={false}
              />
              {loading && <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />}
              {query && !loading && (
                <button
                  onClick={() => { setQuery(''); inputRef.current?.focus() }}
                  aria-label="Clear search"
                  className="text-muted-foreground hover:text-white transition-colors p-0.5 rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Genres dropdown (anime tab) */}
          {activeTab === 'anime' && (
            <div className="w-40">
              <h2 className="text-base font-extrabold text-white mb-2">Genres</h2>
              <GenreDropdown
                genres={allGenres}
                selected={filters.genres ?? []}
                onToggle={toggleGenre}
                onClear={() => setFilters((p) => ({ ...p, genres: null }))}
              />
            </div>
          )}

          {/* Sort by dropdown */}
          <div className="w-44">
            <h2 className="text-base font-extrabold text-white mb-2">Sort by</h2>
            <SortDropdown
              value={(filters.orderBy ?? 'popularity')}
              asc={(filters.sort ?? 'desc') === 'asc'}
              onChange={(orderBy, asc) =>
                setFilters((p) => ({ ...p, orderBy, sort: asc ? 'asc' : 'desc' }))
              }
            />
          </div>

          {/* Year dropdown (anime tab) */}
          {activeTab === 'anime' && (
            <div className="w-32">
              <h2 className="text-base font-extrabold text-white mb-2">Year</h2>
              <YearDropdown
                value={filters.yearFrom ?? null}
                onChange={(y) => setFilters((p) => ({ ...p, yearFrom: y, yearTo: y }))}
              />
            </div>
          )}

          {/* Clear-all (trash) — always visible, resets filters + query */}
          <div className="flex items-end gap-2">
            <button
              onClick={() => { setFilters({}); setQuery('') }}
              aria-label="Clear search and filters"
              title="Clear search and filters"
              className="h-[42px] w-[46px] grid place-items-center rounded-xl bg-white/[0.03] border border-white/10 text-white/60 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-all"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile filter panel — below lg (has format/status/year/genres) */}
        {activeTab === 'anime' && (
          <div className="mt-3 lg:hidden">
            <SearchFilters value={filters} onChange={setFilters} />
          </div>
        )}
      </div>

      {/* ══════════ Left filter rail + results ══════════ */}
      <div className="max-w-[1600px] mx-auto px-4">
        <div className="flex gap-5 items-start">
          {/* ── Left rail — Season / Format / Status / Min score (desktop) ── */}
          {activeTab === 'anime' && (
            <aside className="hidden lg:flex flex-col gap-3 w-[230px] shrink-0 sticky top-20">
              <FilterRail filters={filters} onChange={setFilters} />
            </aside>
          )}

          {/* ── Main content ── */}
          <div className="min-w-0 flex-1">

            {/* ── Tabs ── */}
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
                {/* Mobile: virtualized poster grid */}
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

                {/* Desktop: poster grid (anikage-style) — full AnimeCard features */}
                <div className="hidden lg:grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-6">
                  {searchResults.map((anime) => (
                    <AnimeCard key={anime.mal_id} anime={anime} />
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
        </div>{/* /flex row: rail + content */}
      </div>
    </div>
    </ErrorBoundary>
  )
}

// ─────────────────────────────────────────────────────────────────
// Collapsible radio rail (Season / Format / Status / Min score) —
// the left sidebar from the anikage-style redesign. Sections collapse
// with a chevron; options behave like radios (click to select, click
// again to reset to "any").
// ─────────────────────────────────────────────────────────────────

const RAIL_SEASONS = [
  { value: 'winter', label: 'Winter' },
  { value: 'spring', label: 'Spring' },
  { value: 'summer', label: 'Summer' },
  { value: 'fall', label: 'Fall' },
]

const RAIL_FORMATS = [
  { value: 'tv', label: 'TV' },
  { value: 'tv_short', label: 'TV Short' },
  { value: 'movie', label: 'Movie' },
  { value: 'special', label: 'Special' },
  { value: 'ova', label: 'OVA' },
  { value: 'ona', label: 'ONA' },
  { value: 'music', label: 'Music' },
]

const RAIL_STATUSES = [
  { value: 'airing', label: 'Airing' },
  { value: 'complete', label: 'Completed' },
  { value: 'upcoming', label: 'Not Yet Released' },
]

const RAIL_SCORES = [
  { value: null, label: 'Any' },
  { value: 9, label: '9+' },
  { value: 8, label: '8+' },
  { value: 7, label: '7+' },
  { value: 6, label: '6+' },
]

/** One collapsible radio group inside the rail. */
function RailSection({
  title, options, active, onSelect,
}: {
  title: string
  options: { value: string | number | null; label: string }[]
  active: string | number | null
  onSelect: (v: string | number | null) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-bold text-white">{title}</span>
        {open
          ? <ChevronUp className="h-4 w-4 text-white/50" />
          : <ChevronDown className="h-4 w-4 text-white/50" />}
      </button>
      {open && (
        <div className="mt-2.5 space-y-0.5">
          {options.map((o) => {
            const selected = active === o.value
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => onSelect(selected ? null : o.value)}
                className="w-full flex items-center gap-2.5 px-1 py-1.5 text-left text-xs text-white/55 hover:text-white transition-colors group"
              >
                {/* Radio dot */}
                <span
                  className={cn(
                    'h-3.5 w-3.5 rounded-full border grid place-items-center shrink-0 transition-colors',
                    selected ? 'border-primary' : 'border-white/25 group-hover:border-white/45',
                  )}
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </span>
                <span className={selected ? 'text-white font-semibold' : ''}>{o.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Left rail: Season / Format / Status / Min score. */
const FilterRail = React.memo(function FilterRail({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <>
      <RailSection
        title="Season"
        options={RAIL_SEASONS}
        active={filters.season ?? null}
        onSelect={(v) => onChange({ ...filters, season: (v as Filters['season']) ?? null })}
      />
      <RailSection
        title="Format"
        options={RAIL_FORMATS}
        active={filters.format ?? null}
        onSelect={(v) => onChange({ ...filters, format: (v as Filters['format']) ?? null })}
      />
      <RailSection
        title="Status"
        options={RAIL_STATUSES}
        active={filters.status ?? null}
        onSelect={(v) => onChange({ ...filters, status: (v as Filters['status']) ?? null })}
      />
      <RailSection
        title="Min score"
        options={RAIL_SCORES}
        active={filters.minScore ?? null}
        onSelect={(v) => onChange({ ...filters, minScore: v == null ? null : Number(v) })}
      />
    </>
  )
})

// ─────────────────────────────────────────────────────────────────
// Top-bar dropdowns — Genres (multi-select), Sort by, Year.
// ╰─ checkbox list inside a floating panel, chevron flip on open.
// ─────────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'score', label: 'Score' },
  { value: 'start_date', label: 'Newest' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'rank', label: 'Rank' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 31 }, (_, i) => CURRENT_YEAR + 1 - i)

/** Shared click-outside + chevron dropdown wrapper. */
function Dropdown({ label, open, onToggle, children, width = 'w-full' }: {
  label: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  width?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onToggle()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onToggle])

  return (
    <div ref={ref} className={cn('relative', width)}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between gap-2 h-[42px] px-4 rounded-xl border text-sm transition-all',
          open
            ? 'border-primary/50 bg-white/[0.05] text-white'
            : 'border-white/10 bg-white/[0.03] text-white/85 hover:bg-white/[0.05]',
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-white/50 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          className={cn(
            'absolute z-40 mt-2 rounded-xl border border-white/10 bg-zinc-950/95 backdrop-blur-xl shadow-2xl',
            'max-h-[340px] overflow-y-auto custom-scrollbar',
          )}
          data-lenis-prevent
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** Genres multi-select dropdown. */
function GenreDropdown({ genres, selected, onToggle, onClear }: {
  genres: Genre[]
  selected: number[]
  onToggle: (id: number) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((o) => !o), [])
  const label =
    selected.length === 0
      ? 'Any'
      : selected.length === 1
        ? genres.find((g) => g.mal_id === selected[0])?.name ?? '1 genre'
        : `${selected.length} genres`

  return (
    <Dropdown label={label} open={open} onToggle={toggle}>
      <div className="p-1.5 w-56">
        <button
          type="button"
          onClick={() => { onClear(); setOpen(false) }}
          className={cn(
            'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
            selected.length === 0 ? 'text-primary font-semibold bg-primary/10' : 'text-white/60 hover:bg-white/[0.05] hover:text-white',
          )}
        >
          Any genre
        </button>
        <div className="h-px bg-white/8 my-1" />
        {genres.map((g) => {
          const checked = selected.includes(g.mal_id)
          return (
            <button
              key={g.mal_id}
              type="button"
              onClick={() => onToggle(g.mal_id)}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/[0.05] hover:text-white transition-colors"
            >
              <span
                className={cn(
                  'h-3.5 w-3.5 rounded border grid place-items-center shrink-0 transition-colors',
                  checked ? 'bg-primary border-primary' : 'border-white/25',
                )}
              >
                {checked && (
                  <svg viewBox="0 0 10 8" className="h-2 w-2 fill-none stroke-white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 4l2.5 2.5L9 1" />
                  </svg>
                )}
              </span>
              <span className={checked ? 'text-white' : ''}>{g.name}</span>
              <span className="ml-auto text-[10px] text-white/30 tabular-nums">
                {g.count >= 1000 ? `${(g.count / 1000).toFixed(1)}k` : g.count}
              </span>
            </button>
          )
        })}
      </div>
    </Dropdown>
  )
}

/** Sort-by dropdown with asc/desc direction flip on re-click. */
function SortDropdown({ value, asc, onChange }: {
  value: string
  asc: boolean
  onChange: (orderBy: string, asc: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((o) => !o), [])
  const current = SORT_OPTIONS.find((o) => o.value === value)
  const label = current?.label ?? 'Popularity'

  return (
    <Dropdown label={label} open={open} onToggle={toggle}>
      <div className="p-1.5 w-48">
        {SORT_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => {
              if (o.value === value) onChange(o.value, !asc) // flip direction
              else onChange(o.value, false)
              setOpen(false)
            }}
            className={cn(
              'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors',
              o.value === value ? 'text-primary font-semibold bg-primary/10' : 'text-white/60 hover:bg-white/[0.05] hover:text-white',
            )}
          >
            {o.label}
            {o.value === value && (
              <span className="text-[10px] text-primary/80">{asc ? '↑ asc' : '↓ desc'}</span>
            )}
          </button>
        ))}
      </div>
    </Dropdown>
  )
}

/** Year dropdown — single "from" year, Any resets. */
function YearDropdown({ value, onChange }: {
  value: number | null
  onChange: (y: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((o) => !o), [])

  return (
    <Dropdown label={value != null ? String(value) : 'Any'} open={open} onToggle={toggle}>
      <div className="p-1.5 w-32">
        <button
          type="button"
          onClick={() => { onChange(null); setOpen(false) }}
          className={cn(
            'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors',
            value == null ? 'text-primary font-semibold bg-primary/10' : 'text-white/60 hover:bg-white/[0.05] hover:text-white',
          )}
        >
          Any
        </button>
        {YEAR_OPTIONS.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => { onChange(y); setOpen(false) }}
            className={cn(
              'w-full text-left px-3 py-2 rounded-lg text-xs tabular-nums transition-colors',
              value === y ? 'text-primary font-semibold bg-primary/10' : 'text-white/60 hover:bg-white/[0.05] hover:text-white',
            )}
          >
            {y}
          </button>
        ))}
      </div>
    </Dropdown>
  )
}

export default function SearchPage() {
  return (
    <ErrorBoundary scope="Search">
      <SearchPageContent />
    </ErrorBoundary>
  )
}
