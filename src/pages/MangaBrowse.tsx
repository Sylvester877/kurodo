import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, BookOpen, TrendingUp, Star, Loader2, Compass,
  ListFilter, Play, SlidersHorizontal, Check, X,
} from 'lucide-react'
import { cn } from '../lib/utils'
import MangaContinueReadingRail from '../components/MangaContinueReadingRail'
import {
  getLatestManga, browseManga, getBrowseTags,
  type BrowseTags,
} from '../api/mangadex'
import { getTrendingManga, getPopularManga, searchMangaAniList } from '../api/anilistManga'
import { useDebounce } from '../hooks/useDebounce'
import { SkeletonCard } from '../components/Skeleton'

type Tab = 'trending' | 'popular' | 'latest' | 'browse'
type FormatFilter = string | null // null = all

const GENRE_LABELS: Record<string, string> = {
  action: 'Action', adventure: 'Adventure', 'boys-love': 'Boys Love',
  comedy: 'Comedy', crime: 'Crime', drama: 'Drama', fantasy: 'Fantasy',
  'girls-love': 'Girls Love', gourmet: 'Gourmet', horror: 'Horror',
  isekai: 'Isekai', 'magical-girls': 'Magical Girls', mecha: 'Mecha',
  medical: 'Medical', music: 'Music', mystery: 'Mystery',
  philosophical: 'Philosophical', psychological: 'Psychological',
  romance: 'Romance', 'sci-fi': 'Sci-Fi', 'slice-of-life': 'Slice of Life',
  sports: 'Sports', supernatural: 'Supernatural', thriller: 'Thriller',
  tragedy: 'Tragedy', vampires: 'Vampires', 'martial-arts': 'Martial Arts',
  'post-apocalyptic': 'Post-Apocalyptic', 'reverse-harem': 'Reverse Harem',
  superhero: 'Superhero', survival: 'Survival', zombies: 'Zombies',
}

const FORMAT_LABELS: Record<string, string> = {
  manga: 'Manga', manhwa: 'Manhwa', manhua: 'Manhua',
  oneshot: 'One-Shot', doujinshi: 'Doujinshi', novel: 'Light Novel',
  '4-koma': '4-Koma', anthology: 'Anthology',
}

const STATUS_OPTIONS = [
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'hiatus', label: 'Hiatus' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

const SORT_OPTIONS = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'latest', label: 'Latest Updates' },
  { value: 'newest', label: 'Newest' },
  { value: 'trending', label: 'Trending' },
] as const

export default function MangaBrowse() {
  const [tab, setTab] = useState<Tab>('trending')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [formatFilter, setFormatFilter] = useState<FormatFilter>(null)

  // ── Browse filters ──
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [browseFormat, setBrowseFormat] = useState<string | null>(null)
  const [browseStatus, setBrowseStatus] = useState<string | null>(null)
  const [browseSort, setBrowseSort] = useState<string>('popular')
  const [showGenreDropdown, setShowGenreDropdown] = useState(false)
  const genreMenuRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // ── Tags (cached aggressively) ──
  const tagsQuery = useQuery({
    queryKey: ['manga-tags'],
    queryFn: getBrowseTags,
    staleTime: 24 * 60 * 60 * 1000,
  })
  const tags: BrowseTags | undefined = tagsQuery.data

  // ── Existing tab queries ──
  const trendingQuery = useQuery({
    queryKey: ['manga', 'trending'],
    queryFn: () => getTrendingManga(40),
    staleTime: 10 * 60 * 1000,
    enabled: tab === 'trending',
  })

  const popularQuery = useQuery({
    queryKey: ['manga', 'popular'],
    queryFn: () => getPopularManga(40),
    staleTime: 10 * 60 * 1000,
    enabled: tab === 'popular',
  })

  const latestQuery = useQuery({
    queryKey: ['manga', 'latest'],
    queryFn: () => getLatestManga(40),
    staleTime: 5 * 60 * 1000,
    enabled: tab === 'latest',
  })

  // ── Browse infinite query ──
  const browseQuery = useInfiniteQuery({
    queryKey: ['manga', 'browse', selectedGenres, browseFormat, browseStatus, browseSort],
    queryFn: async ({ pageParam }) => {
      const offset = ((pageParam as number) - 1) * 24
      return browseManga({
        genres: selectedGenres.length > 0 ? selectedGenres : undefined,
        format: browseFormat,
        status: browseStatus ? [browseStatus] : undefined,
        sort: browseSort,
        limit: 24,
        offset,
      })
    },
    getNextPageParam: (last, pages) =>
      last.results.length === 24 ? pages.length + 1 : undefined,
    initialPageParam: 1,
    staleTime: 5 * 60 * 1000,
    enabled: tab === 'browse',
  })

  // ── Search ──
  const searchQuery = useQuery({
    queryKey: ['manga', 'search', debouncedSearch],
    queryFn: () => searchMangaAniList(debouncedSearch, 24),
    enabled: debouncedSearch.trim().length >= 2,
    staleTime: 2 * 60 * 1000,
  })

  const searching = searchQuery.isFetching && debouncedSearch.trim().length >= 2
  const searchResults = searchQuery.data ?? []
  const showSearch = debouncedSearch.trim().length >= 2

  // ── Derived data ──
  const rawData =
    tab === 'trending' ? trendingQuery.data ?? [] :
    tab === 'popular' ? popularQuery.data ?? [] :
    tab === 'latest' ? latestQuery.data?.results ?? [] :
    []

  // Format filter for AniList tabs (trending/popular)
  const activeData = useMemo(() => {
    if (tab === 'latest' || tab === 'browse') return rawData
    if (!formatFilter) return rawData
    return (rawData as any[]).filter((m: any) => m.format === formatFilter)
  }, [rawData, tab, formatFilter])

  const browsePages = browseQuery.data?.pages ?? []
  const browseResults = browsePages.flatMap((p) => p.results)
  const browseTotal = browsePages[0]?.total ?? 0

  const loading =
    tab === 'trending' ? trendingQuery.isLoading :
    tab === 'popular' ? popularQuery.isLoading :
    tab === 'latest' ? latestQuery.isLoading :
    browseQuery.isLoading

  const loadingMore = browseQuery.isFetchingNextPage

  // Close genre dropdown on outside click
  useEffect(() => {
    if (!showGenreDropdown) return
    const onClick = (e: MouseEvent) => {
      if (!genreMenuRef.current?.contains(e.target as Node)) setShowGenreDropdown(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [showGenreDropdown])

  // Infinite-scroll observer for browse tab
  useEffect(() => {
    if (tab !== 'browse') return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && browseQuery.hasNextPage && !browseQuery.isFetchingNextPage) {
          void browseQuery.fetchNextPage()
        }
      },
      { threshold: 0.1 },
    )
    if (loadMoreRef.current) obs.observe(loadMoreRef.current)
    return () => obs.disconnect()
  }, [tab, browseQuery])

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'trending', label: 'Trending', icon: TrendingUp },
    { key: 'popular', label: 'Popular', icon: Star },
    { key: 'latest', label: 'Latest', icon: Compass },
    { key: 'browse', label: 'Browse', icon: SlidersHorizontal },
  ]

  const formatTagOptions: { key: string; label: string }[] =
    (tags?.formats ?? []).filter((f) => FORMAT_LABELS[f]).map((f) => ({ key: f, label: FORMAT_LABELS[f] }))

  const genreOptions = tags?.genres ?? []

  // ── Clear browse filters ──
  const clearBrowseFilters = () => {
    setSelectedGenres([])
    setBrowseFormat(null)
    setBrowseStatus(null)
    setBrowseSort('popular')
  }

  const hasActiveBrowseFilters =
    selectedGenres.length > 0 || browseFormat || browseStatus || browseSort !== 'popular'

  return (
    <div className="pt-20 pb-12 px-4 max-w-[1600px] mx-auto">
      {/* Continue Reading rail */}
      <MangaContinueReadingRail />

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/20 grid place-items-center">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Manga</h1>
            <p className="text-xs text-muted-foreground">Discover manga, manhwa & novels · powered by AniList + MangaDex</p>
          </div>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-6">
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 focus-within:border-primary/30 focus-within:bg-white/[0.05] transition-all">
          <Search className="h-4 w-4 text-white/30 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search manga by title…"
            className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder:text-white/30"
          />
          {searching && <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />}
        </div>

        {showSearch && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            data-lenis-prevent className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-white/10 bg-black/95 overflow-hidden z-30 shadow-lg max-h-[60vh] overflow-y-auto custom-scrollbar"
          >
            {searching ? (
              <div className="p-8 text-center">
                <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">Searching...</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-8 text-center">
                <Search className="h-6 w-6 text-white/10 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No manga found for "{search}"</p>
              </div>
            ) : (
              <div>
                <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-white/30 font-bold border-b border-white/[0.05]">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                </div>
                {searchResults.slice(0, 8).map((m) => (
                  <Link
                    key={m.id}
                    to={`/manga/${m.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors border-b border-white/[0.03] last:border-0"
                  >
                    <img src={m.coverImage?.large || m.coverImage?.extraLarge || ''} alt="" className="w-10 h-14 rounded-md object-cover bg-white/[0.04] shrink-0" loading="lazy" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium truncate">{m.title.english || m.title.romaji}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {m.averageScore && (
                          <span className="flex items-center gap-0.5 text-[10px] text-yellow-400">
                            <Star className="h-2.5 w-2.5 fill-yellow-400" />{(m.averageScore / 10).toFixed(1)}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">{m.format || 'Manga'}</span>
                        {m.chapters && <span className="text-[10px] text-muted-foreground">{m.chapters} ch</span>}
                      </div>
                    </div>
                  </Link>
                ))}
                {searchResults.length > 8 && (
                  <div className="px-4 py-3 text-center border-t border-white/[0.05]">
                    <p className="text-[10px] text-muted-foreground">+ {searchResults.length - 8} more results — refine your search</p>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all',
                tab === t.key
                  ? 'bg-primary/15 text-primary border border-primary/20 shadow-[0_4px_12px_-4px_hsl(245,75%,60%,0.25)]'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]',
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Format filter for non-browse, non-latest tabs */}
        {tab !== 'latest' && tab !== 'browse' && (
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
            <ListFilter className="h-3 w-3 text-white/30 shrink-0 ml-1 mr-1" />
            {(['all', 'Manga', 'Manhwa', 'Manhua', 'Novel', 'One Shot'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormatFilter(f === 'all' ? null : f)}
                className={cn(
                  'px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all',
                  (formatFilter === f || (f === 'all' && !formatFilter))
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]',
                )}
              >
                {f === 'all' ? 'All' : f === 'One Shot' ? 'One-Shot' : f}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Browse filter panel ── */}
      <AnimatePresence>
        {tab === 'browse' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 mb-5 space-y-3">
              {/* Genre multi-select */}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-white/30 font-bold mb-2">Genres</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {selectedGenres.map((g) => (
                    <button
                      key={g}
                      onClick={() => setSelectedGenres((prev) => prev.filter((x) => x !== g))}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold bg-primary/20 text-primary border border-primary/25 hover:bg-primary/30 transition-colors"
                    >
                      {GENRE_LABELS[g] || g}
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ))}
                  <div ref={genreMenuRef} className="relative">
                    <button
                      onClick={() => setShowGenreDropdown((s) => !s)}
                      className="px-2 py-1 rounded-md text-[10px] font-medium text-white/50 border border-dashed border-white/15 hover:border-white/30 hover:text-white/70 transition-colors"
                    >
                      + Add genre
                    </button>
                    {showGenreDropdown && (
                      <div data-lenis-prevent className="absolute top-full mt-1 left-0 z-50 min-w-[200px] max-h-[320px] overflow-y-auto custom-scrollbar rounded-xl border border-white/10 bg-black/95 p-2 shadow-lg">
                        {genreOptions.map((g) => {
                          const isSelected = selectedGenres.includes(g)
                          return (
                            <button
                              key={g}
                              onClick={() => {
                                setSelectedGenres((prev) =>
                                  isSelected ? prev.filter((x) => x !== g) : [...prev, g],
                                )
                              }}
                              className={cn(
                                'w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors',
                                isSelected
                                  ? 'bg-primary/15 text-primary font-semibold'
                                  : 'text-white/70 hover:bg-white/5 hover:text-white',
                              )}
                            >
                              <span>{GENRE_LABELS[g] || g}</span>
                              {isSelected && <Check className="h-3 w-3" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                {/* Format dropdown */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/30 font-bold mb-1.5">Type</p>
                  <select
                    value={browseFormat ?? ''}
                    onChange={(e) => setBrowseFormat(e.target.value || null)}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white outline-none focus:border-primary/30 cursor-pointer"
                  >
                    <option value="">All types</option>
                    {formatTagOptions.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </div>

                {/* Status dropdown */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/30 font-bold mb-1.5">Status</p>
                  <select
                    value={browseStatus ?? ''}
                    onChange={(e) => setBrowseStatus(e.target.value || null)}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white outline-none focus:border-primary/30 cursor-pointer"
                  >
                    <option value="">Any status</option>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                {/* Sort dropdown */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/30 font-bold mb-1.5">Sort by</p>
                  <select
                    value={browseSort}
                    onChange={(e) => setBrowseSort(e.target.value)}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white outline-none focus:border-primary/30 cursor-pointer"
                  >
                    {SORT_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>

                {/* Clear button */}
                {hasActiveBrowseFilters && (
                  <div className="self-end">
                    <button
                      onClick={clearBrowseFilters}
                      className="px-3 py-1.5 rounded-lg text-[10px] font-semibold text-white/40 hover:text-white/70 border border-white/10 hover:border-white/20 transition-colors"
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>

              {/* Browse result count */}
              {!browseQuery.isLoading && (
                <p className="text-[10px] text-muted-foreground">
                  {browseTotal.toLocaleString()} manga found
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Results grid ── */}
      {showSearch ? (
        searchResults.length === 0 ? (
          <div className="py-16 text-center">
            <Search className="h-10 w-10 text-white/10 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No manga found for "{debouncedSearch}"</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-x-4 gap-y-6">
            {searchResults.map((m) => (
              <MangaBrowseCard
                key={m.id}
                id={m.id}
                title={m.title.english || m.title.romaji || 'Untitled'}
                coverUrl={m.coverImage?.large || m.coverImage?.extraLarge || ''}
                score={m.averageScore ? m.averageScore / 10 : null}
                format={m.format || 'Manga'}
                chapters={m.chapters}
                year={m.startDate?.year || null}
              />
            ))}
          </div>
        )
      ) : tab === 'browse' ? (
        /* ── Browse tab: infinite scroll from MangaDex ── */
        loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-x-4 gap-y-6">
            {Array.from({ length: 12 }).map((_, idx) => (<SkeletonCard key={idx} />))}
          </div>
        ) : browseResults.length === 0 ? (
          <div className="glass-card rounded-2xl py-20 text-center">
            <SlidersHorizontal className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" />
            <p className="text-white/80 font-semibold mb-1">No manga found</p>
            <p className="text-xs text-muted-foreground">Try adjusting your filters</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-x-4 gap-y-6">
              {browseResults.map((m) => (
                <MangaBrowseCard
                  key={m.id}
                  id={m.id}
                  title={m.title}
                  coverUrl={m.coverUrl ?? ''}
                  year={m.year}
                  lastChapter={m.lastChapter}
                  isMangaDex
                />
              ))}
            </div>
            <div ref={loadMoreRef} className="flex justify-center py-10">
              {loadingMore ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider">Loading more</span>
                </div>
              ) : !browseQuery.hasNextPage && browseResults.length > 0 ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <div className="h-px w-10 bg-white/[0.06]" />
                  <span className="text-[10px] uppercase tracking-wider font-semibold">
                    All caught up · {browseTotal.toLocaleString()} titles
                  </span>
                  <div className="h-px w-10 bg-white/[0.06]" />
                </div>
              ) : null}
            </div>
          </>
        )
      ) : loading && (tab === 'trending' || tab === 'popular') ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-x-4 gap-y-6">
          {Array.from({ length: 12 }).map((_, idx) => (<SkeletonCard key={idx} />))}
        </div>
      ) : activeData.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-x-4 gap-y-6">
          {activeData.map((m: any) => {
            const isMangaDex = !!m.coverUrl
            return isMangaDex ? (
              <MangaBrowseCard
                key={m.id || m.coverUrl}
                id={m.id}
                title={m.title}
                coverUrl={m.coverUrl}
                year={m.year}
                lastChapter={m.lastChapter}
                isMangaDex
              />
            ) : (
              <MangaBrowseCard
                key={m.id || m.mal_id || m.idMal}
                id={m.id}
                title={m.title?.english || m.title?.romaji || 'Untitled'}
                coverUrl={m.coverImage?.large || m.coverImage?.extraLarge || ''}
                score={m.averageScore ? m.averageScore / 10 : null}
                format={m.format || 'Manga'}
                chapters={m.chapters}
                year={m.startDate?.year || null}
              />
            )
          })}
        </div>
      ) : (
        <div className="py-16 text-center">
          <BookOpen className="h-12 w-12 text-white/10 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No manga found.</p>
        </div>
      )}
    </div>
  )
}

/**
 * Manga-specific card that links directly to /manga/:id.
 * Unlike AnimeCard, this has NO inner <Link> — so it won't conflict
 * with an outer wrapper. Uses framer-motion for hover lift.
 */
function MangaBrowseCard({
  id,
  title,
  coverUrl,
  score,
  format,
  chapters,
  year,
  lastChapter,
  isMangaDex,
}: {
  id: number | string
  title: string
  coverUrl: string
  score?: number | null
  format?: string
  chapters?: number | null
  year?: number | null
  lastChapter?: string | null
  isMangaDex?: boolean
}) {
  const linkTo = `/manga/${id}`

  return (
    <Link to={linkTo} className="group block h-full">
      <motion.div
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.98 }}
        className="rounded-xl overflow-hidden bg-card border border-white/5 hover:border-primary/30 transition-all h-full"
      >
        {/* Poster */}
        <div className="aspect-[3/4] overflow-hidden relative">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={title}
              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-400"
              loading="lazy"
            />
          ) : (
            <div className="h-full w-full grid place-items-center bg-white/[0.03]">
              <BookOpen className="h-8 w-8 text-white/10" />
            </div>
          )}

          {/* Score badge */}
          {score != null && (
            <div className="absolute top-2 right-2 glass-pill py-0.5 px-1.5 bg-black/70 border-white/10 text-[9px] font-bold text-white shadow-lg">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              <span>{score.toFixed(1)}</span>
            </div>
          )}

          {/* Chapter badge (MangaDex) */}
          {lastChapter && (
            <div className="absolute bottom-2 left-2 glass-pill py-0.5 px-1.5 bg-black/70 border-white/10 text-[9px] font-semibold text-white shadow-lg">
              Ch. {lastChapter}
            </div>
          )}

          {/* Format badge */}
          {format && !isMangaDex && (
            <div className="absolute top-2 left-2 glass-pill py-0.5 px-1.5 bg-emerald-500/80 border-emerald-400/40 text-[9px] font-bold text-white uppercase shadow-lg">
              {format}
            </div>
          )}

          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
            <div className="h-11 w-11 rounded-full bg-primary/90 text-white flex items-center justify-center shadow-[0_0_20px_rgba(139,92,246,0.6)] scale-75 group-hover:scale-100 transition-transform duration-200">
              <Play className="h-[18px] w-[18px] ml-0.5 fill-current" />
            </div>
          </div>
        </div>

        {/* Caption */}
        <div className="p-2.5">
          <p className="text-xs font-semibold text-white/90 line-clamp-2 leading-tight group-hover:text-white transition-colors">
            {title}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5 text-[10px] flex-wrap">
            {chapters != null && !isMangaDex && (
              <span className="text-white/40">{chapters} ch</span>
            )}
            {year && (
              <>
                {(chapters != null || lastChapter) && <span className="text-white/20">·</span>}
                <span className="text-white/40">{year}</span>
              </>
            )}
            {lastChapter && isMangaDex && (
              <span className="text-white/40 ml-auto">Ch. {lastChapter}</span>
            )}
            {score != null && !isMangaDex && (
              <span className="text-yellow-400/80 ml-auto tabular-nums">{score.toFixed(1)} ★</span>
            )}
          </div>
        </div>
      </motion.div>
    </Link>
  )
}
