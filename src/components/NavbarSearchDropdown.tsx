import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, useId } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, X, History, Loader2, ArrowRight, Star, BookOpen } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { searchAnime } from '../api/anime'
import { searchMangaAniList, type MangaFeedMedia } from '../api/anilistManga'
import { useDebounce } from '../hooks/useDebounce'
import {
  loadRecentSearches,
  pushRecentSearch,
  removeRecentSearch,
  clearRecentSearches,
} from '../lib/recentSearches'
import { getSmallImageUrl, cn } from '../lib/utils'
import { preloadHandlers, preloaders } from '../lib/routePreloaders'
import { prefetchAnimeEpInfo } from '../lib/prefetch'
import type { Anime } from '../types'

interface Props {
  /** Optional placeholder override (e.g. "Search anime, manga…"). */
  placeholder?: string
  /** Auto-focus the input on mount. */
  autoFocus?: boolean
  /** Called when the user picks any result, presses Enter, or escapes. */
  onClose?: () => void
  /** Content type filter — only show results for this type. Defaults to 'anime'. */
  contentType?: 'anime' | 'manga'
}

/**
 * Search-as-you-type dropdown for the navbar.
 *
 * Behavior:
 *   - Debounces typing by 250ms, fetches up to 6 anime results.
 *   - Shows recent searches when input is empty.
 *   - Full keyboard support:
 *       Esc          → close (calls onClose)
 *       ↓ / ↑        → move highlight through results + "See all"
 *       Enter        → open highlighted result, or jump to /search?q= if
 *                       no result is highlighted (Google-style)
 *   - Preloads the AnimeDetails / Search chunk on hover-intent of each
 *     row so the click feels instant.
 *
 * State lives entirely inside this component — the parent only owns
 * "is the dropdown open" via its own flag.
 */
export default function NavbarSearchDropdown({
  placeholder,
  autoFocus = false,
  onClose,
  contentType = 'anime',
}: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const debounced = useDebounce(query, 250)
  // Default to -1 (no row pre-selected) so Enter behaves Google-style:
  // committing to /search?q= when the user hasn't arrowed. The previous
  // default of 0 silently opened the first result and surprised users
  // expecting a results page (e.g. typing "black clover" + Enter landed
  // them on /anime/53540). The user-reported bug.
  const [highlight, setHighlight] = useState(-1)
  const [recents, setRecents] = useState<string[]>(() => loadRecentSearches())
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Unique per-instance id (avoids collisions when both the desktop navbar
  // and the mobile-menu navbar render the same component at the same time).
  const inputId = useId()

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Reset selection to "uncommitted" whenever the query or results change.
  // ArrowDown from -1 → 0 (first anime), ArrowUp → totalRows-1 ("View all").
  useEffect(() => setHighlight(-1), [debounced])

  // Fetch results via React Query so navbar searches share the cache
  // with the /search page (no double-fetching on submit).
  const trimmed = debounced.trim()
  const searchEnabled = trimmed.length >= 2
  const showAnime = contentType === 'anime'
  const showManga = contentType === 'manga'
  const { data, isFetching } = useQuery({
    queryKey: ['search', trimmed, 1, 6],
    queryFn: () => searchAnime(trimmed, 1, 6),
    enabled: searchEnabled && showAnime,
    staleTime: 5 * 60 * 1000,
  })
  const results: Anime[] = data?.data ?? []
  const hasQuery = trimmed.length >= 2

  // Manga search — parallel fetch from AniList (only on manga pages)
  const { data: mangaData } = useQuery({
    queryKey: ['manga-search', trimmed],
    queryFn: () => searchMangaAniList(trimmed, 4),
    enabled: searchEnabled && showManga,
    staleTime: 5 * 60 * 1000,
  })
  const mangaResults: MangaFeedMedia[] = mangaData ?? []

  // Total rows for keyboard nav: anime results + manga results + 1 "See all".
  const hasAnime = hasQuery && results.length > 0 && showAnime
  const hasManga = hasQuery && mangaResults.length > 0 && showManga
  const totalRows = (hasAnime ? results.length : 0) + (hasManga ? mangaResults.length : 0) + ((hasAnime || hasManga) ? 1 : 0)

  // Commit (called from Enter, click, or recent-search pill click).
  const commit = (q: string) => {
    const cleaned = q.trim()
    if (!cleaned) return
    setRecents(pushRecentSearch(cleaned))
    setQuery('')
    onClose?.()
    const typeParam = contentType === 'manga' ? '&type=manga' : ''
    navigate(`/search?q=${encodeURIComponent(cleaned)}${typeParam}`)
  }

  const openResult = (anime: Anime, e?: MouseEvent) => {
    e?.preventDefault() // Link's `to` is handled by navigate() below
    if (debounced.trim()) setRecents(pushRecentSearch(debounced.trim()))
    setQuery('')
    onClose?.()
    navigate(`/anime/${anime.mal_id}`)
  }

  const openMangaResult = (manga: MangaFeedMedia, e?: MouseEvent) => {
    e?.preventDefault()
    if (debounced.trim()) setRecents(pushRecentSearch(debounced.trim()))
    setQuery('')
    onClose?.()
    navigate(`/manga/${manga.id}`)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('')
      } else {
        onClose?.()
      }
      return
    }
    if (e.key === 'Enter') {
      const animeCount = results.length
      const mangaCount = mangaResults.length
      // -1 means "no row explicitly picked" → fall through to commit()
      // so the user lands on /search?q= instead of the top suggestion.
      if (highlight >= 0 && highlight < animeCount && results[highlight]) {
        openResult(results[highlight])
      } else if (
        highlight >= animeCount &&
        highlight < animeCount + mangaCount &&
        mangaResults[highlight - animeCount]
      ) {
        openMangaResult(mangaResults[highlight - animeCount])
      } else if (trimmed) {
        commit(trimmed)
      }
      return
    }
    if (totalRows === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      // From "uncommitted" (-1), first ArrowDown moves to first anime result.
      setHighlight((h) => (h === -1 ? 0 : (h + 1) % totalRows))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      // From "uncommitted" (-1) OR top row (0), ArrowUp jumps to the
      // "View all results" button (last row). The naive
      // `(h - 1 + totalRows) % totalRows` would skip it (yields totalRows-2).
      setHighlight((h) => (h <= 0 ? totalRows - 1 : h - 1))
    }
  }

  // Scroll the highlighted row into view as the user arrows through.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 focus-within:border-primary focus-within:bg-white/[0.07] focus-within:shadow-[0_0_22px_-8px_hsl(245,75%,60%,0.55)] transition-all">
        <span className="sr-only">{placeholder}</span>
        <Search className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          {...preloadHandlers('/search')}
          className="bg-transparent border-none outline-none text-sm w-full text-white placeholder:text-muted-foreground"
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-expanded={hasQuery || recents.length > 0}
        />
        {isFetching && hasQuery && (
          <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
        )}
        {query && !isFetching && (
          <button
            type="button"
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            aria-label="Clear search"
            className="text-muted-foreground hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown body — shown for both empty (recents) and active (results) states. */}
      <div
        ref={listRef}
        className="absolute top-full mt-2 left-0 right-0 max-h-[70vh] overflow-y-auto custom-scrollbar bg-card border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 animate-[fadeInUp_0.15s_ease]"
      >
        {/* Empty input: show recent searches if any */}
        {!hasQuery && (
          recents.length > 0 ? (
            <div className="p-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-white/50">
                  <History className="h-3 w-3" /> Recent searches
                </div>
                <button
                  onClick={() => { clearRecentSearches(); setRecents([]) }}
                  className="text-[10px] text-muted-foreground hover:text-white"
                >
                  Clear
                </button>
              </div>
              {recents.map((q) => (
                <div
                  key={q}
                  className="group flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 transition-colors"
                >
                  <button
                    onClick={() => commit(q)}
                    className="flex-1 min-w-0 text-left flex items-center gap-2 text-sm text-white/85 truncate"
                  >
                    <Search className="h-3.5 w-3.5 text-white/40 shrink-0" />
                    <span className="truncate">{q}</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setRecents(removeRecentSearch(q))
                    }}
                    aria-label={`Remove "${q}" from recent searches`}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-white/40 hover:text-white"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {showManga
                ? 'Start typing to search manga & manhwa.'
                : 'Start typing to search 100k+ anime.'}
            </div>
          )
        )}

        {/* Active query: results */}
        {hasQuery && (
          <>
            {/* Loading row (only when we don't already have stale data). */}
            {isFetching && results.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                Searching…
              </div>
            )}

            {/* Empty state */}
            {!isFetching && results.length === 0 && (
              <div className="px-3 py-5 text-center">
                <p className="text-sm text-white/80 font-medium mb-1">
                  No matches for "{trimmed}"
                </p>
                <button
                  onClick={() => commit(trimmed)}
                  className="text-xs text-primary hover:underline"
                >
                  Open advanced search →
                </button>
              </div>
            )}

            {/* Result rows */}
            {results.map((anime, i) => {
              const isActive = i === highlight
              return (
                <Link
                  key={anime.mal_id}
                  data-row={i}
                  to={`/anime/${anime.mal_id}`}
                  onClick={(e) => openResult(anime, e)}
                  onMouseEnter={() => {
                    setHighlight(i)
                    preloaders.animeDetails()
                    prefetchAnimeEpInfo(anime.mal_id)
                  }}
                  onFocus={() => prefetchAnimeEpInfo(anime.mal_id)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 transition-colors',
                    isActive
                      ? 'bg-primary/10 border-l-[3px] border-primary shadow-[inset_4px_0_12px_-6px_hsl(245,75%,60%,0.3)]'
                      : 'border-l-[3px] border-transparent hover:bg-white/5',
                  )}
                >
                  <img
                    src={getSmallImageUrl(anime)}
                    alt=""
                    className="h-14 w-10 rounded object-cover shrink-0 border border-white/5"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">
                      {anime.title_english || anime.title}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] flex-wrap">
                      {anime.type && (
                        <span className="px-1.5 py-px rounded bg-white/8 text-white/70 uppercase font-bold tracking-wide">
                          {anime.type}
                        </span>
                      )}
                      {anime.year && (
                        <span className="text-muted-foreground">{anime.year}</span>
                      )}
                      {anime.score && (
                        <span className="inline-flex items-center gap-0.5 text-amber-400">
                          <Star className="h-2.5 w-2.5 fill-amber-400" />
                          {anime.score}
                        </span>
                      )}
                      {anime.episodes != null && (
                        <span className="text-muted-foreground">· {anime.episodes} ep</span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}

            {/* Manga results */}
            {mangaResults.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-t border-white/5 text-[10px] uppercase tracking-wider font-bold text-emerald-400/70">
                  <BookOpen className="h-3 w-3" />
                  Manga
                </div>
                {mangaResults.map((manga, i) => {
                  const absIdx = results.length + i
                  const isActive = absIdx === highlight
                  const year = manga.startDate?.year || null
                  const cover = manga.coverImage?.large || manga.coverImage?.extraLarge || null
                  return (
                    <Link
                      key={`manga-${manga.id}`}
                      data-row={absIdx}
                      to={`/manga/${manga.id}`}
                      onClick={(e) => openMangaResult(manga, e)}
                      onMouseEnter={() => {
                        setHighlight(absIdx)
                        preloaders.animeDetails()
                      }}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 transition-colors',
                        isActive
                          ? 'bg-emerald-500/10 border-l-[3px] border-emerald-500/60 shadow-[inset_4px_0_12px_-6px_hsl(160,84%,39%,0.3)]'
                          : 'border-l-[3px] border-transparent hover:bg-white/5',
                      )}
                    >
                      {cover ? (
                        <img
                          src={cover}
                          alt=""
                          className="h-14 w-10 rounded object-cover shrink-0 border border-white/5"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="h-14 w-10 rounded bg-white/[0.04] border border-white/5 shrink-0 grid place-items-center">
                          <BookOpen className="h-4 w-4 text-white/10" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">
                          {manga.title.english || manga.title.romaji}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] flex-wrap">
                          {manga.format && (
                            <span className="px-1.5 py-px rounded bg-emerald-500/10 text-emerald-400/80 uppercase font-bold tracking-wide">
                              {manga.format}
                            </span>
                          )}
                          {year && (
                            <span className="text-muted-foreground">{year}</span>
                          )}
                          {manga.averageScore && (
                            <span className="inline-flex items-center gap-0.5 text-amber-400">
                              <Star className="h-2.5 w-2.5 fill-amber-400" />
                              {(manga.averageScore / 10).toFixed(1)}
                            </span>
                          )}
                          {manga.chapters != null && (
                            <span className="text-muted-foreground">· {manga.chapters} ch</span>
                          )}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </>
            )}

            {/* See-all-results pinned at bottom */}
            {(results.length > 0 || mangaResults.length > 0) && (
              <button
                data-row={results.length + mangaResults.length}
                onClick={() => commit(trimmed)}
                onMouseEnter={() => setHighlight(results.length + mangaResults.length)}
                className={cn(
                  'w-full flex items-center justify-center gap-1.5 text-sm py-2.5 border-t border-white/5 transition-colors',
                  highlight === results.length + mangaResults.length
                    ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_hsl(245,75%,60%,0.15)]'
                    : 'text-primary hover:bg-white/5',
                )}
              >
                View all results for "{trimmed}"
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
