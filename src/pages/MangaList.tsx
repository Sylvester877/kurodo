import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, CheckCircle2, Clock, Trash2, Bookmark, Search, X, ArrowUpDown, Play, Loader2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { useMangaListStore, type MangaEntry } from '../store/useMangaListStore'
import { getChapterFeed } from '../api/mangadex'
import EmptyState from '../components/EmptyState'

type Filter = 'all' | 'reading' | 'completed' | 'planning'
type Sort = 'title' | 'progress' | 'chapters'

export default function MangaList() {
  const mangaList = useMangaListStore((s) => s.mangaList)
  const readChapters = useMangaListStore((s) => s.readChapters)
  const removeFromMangaList = useMangaListStore((s) => s.removeFromMangaList)
  const getReadCount = useMangaListStore((s) => s.getReadCount)
  const getLatestChapter = useMangaListStore((s) => s.getLatestChapter)

  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('title')
  const [query, setQuery] = useState('')

  // Stats
  const stats = useMemo(() => {
    const totalChapters = Object.values(readChapters).reduce((sum, chs) => sum + chs.length, 0)
    const reading = mangaList.filter((m) => {
      const read = getReadCount(m.mal_id)
      const total = m.chapters || Infinity
      return read > 0 && read < total
    }).length
    const completed = mangaList.filter((m) => {
      const read = getReadCount(m.mal_id)
      const total = m.chapters || Infinity
      return total != null && read >= total
    }).length
    return { totalChapters, reading, completed, total: mangaList.length }
  }, [mangaList, readChapters, getReadCount])

  const filtered = useMemo(() => {
    let list = mangaList.filter((m) => {
      if (query.trim()) {
        const q = query.toLowerCase()
        const title = (m.title_english || m.title).toLowerCase()
        if (!title.includes(q)) return false
      }
      if (filter === 'all') return true
      const read = getReadCount(m.mal_id)
      const total = m.chapters || Infinity
      if (filter === 'completed') return read >= total
      if (filter === 'reading') return read > 0 && read < total
      if (filter === 'planning') return read === 0
      return true
    })

    // Sort
    list = [...list].sort((a, b) => {
      if (sort === 'title') {
        const ta = (a.title_english || a.title).toLowerCase()
        const tb = (b.title_english || b.title).toLowerCase()
        return ta.localeCompare(tb)
      }
      if (sort === 'progress') {
        const ra = getReadCount(a.mal_id)
        const rb = getReadCount(b.mal_id)
        return rb - ra
      }
      if (sort === 'chapters') {
        const ca = a.chapters || 0
        const cb = b.chapters || 0
        return cb - ca
      }
      return 0
    })

    return list
  }, [mangaList, query, filter, sort, getReadCount])

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'reading', label: 'Reading' },
    { key: 'completed', label: 'Completed' },
    { key: 'planning', label: 'Planning' },
  ]

  const sorts: { key: Sort; label: string }[] = [
    { key: 'title', label: 'Title' },
    { key: 'progress', label: 'Progress' },
    { key: 'chapters', label: 'Chapters' },
  ]

  if (mangaList.length === 0) {
    return (
      <div className="pt-20 pb-12 px-4 max-w-[1600px] mx-auto">
        <EmptyState
          icon={<BookOpen className="h-9 w-9" />}
          title="Your manga list is empty"
          description="Start adding manga from the Browse page to track your reading progress."
        >
          <Link
            to="/manga"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20"
          >
            <BookOpen className="h-4 w-4" />
            Browse Manga
          </Link>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="pt-20 pb-12 px-4 max-w-[1600px] mx-auto">
      {/* Header + stats */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/20 grid place-items-center">
            <Bookmark className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Manga List</h1>
            <p className="text-xs text-muted-foreground">
              {stats.total} manga · {stats.totalChapters} chapters read
            </p>
          </div>
        </div>

        {/* Mini stats */}
        {stats.total > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-400">{stats.completed}</span>
              <span className="text-[10px] text-emerald-400/60">done</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <Clock className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-bold text-primary">{stats.reading}</span>
              <span className="text-[10px] text-primary/60">reading</span>
            </div>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border',
                filter === f.key
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-white/[0.04] text-white/70 border-white/8 hover:bg-white/[0.08] hover:text-white',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06] ml-auto">
          <ArrowUpDown className="h-3 w-3 text-white/20 shrink-0 ml-1" />
          {sorts.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={cn(
                'px-2 py-1 rounded-xl text-[10px] font-medium transition-all',
                sort === s.key
                  ? 'bg-white/[0.06] text-white border border-white/10'
                  : 'text-white/35 hover:text-white/70',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Search */}
        {mangaList.length > 6 && (
          <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 focus-within:border-primary/30 transition-all">
            <Search className="h-3.5 w-3.5 text-white/30 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter…"
              className="flex-1 bg-transparent border-none outline-none text-xs text-white placeholder:text-white/30 w-32"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-white/40 hover:text-white">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div className="space-y-3">
        <AnimatePresence>
          {filtered.map((manga) => (
            <MangaRow
              key={manga.mal_id}
              manga={manga}
              readCount={getReadCount(manga.mal_id)}
              latestChapter={getLatestChapter(manga.mal_id)}
              onRemove={() => removeFromMangaList(manga.mal_id)}
            />
          ))}
        </AnimatePresence>

        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <BookOpen className="h-10 w-10 text-white/10 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No manga match this filter.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function MangaRow({
  manga,
  readCount,
  latestChapter,
  onRemove,
}: {
  manga: MangaEntry
  readCount: number
  latestChapter: number | null
  onRemove: () => void
}) {
  const total = manga.chapters || null
  const pct = total ? Math.min(Math.round((readCount / total) * 100), 100) : 0
  const isCompleted = total != null && readCount >= total

  // Fetch chapters to find the next unread chapter for Continue
  const { data: chaptersData, isError: chaptersError } = useQuery({
    queryKey: ['mangadex', 'chapters', manga.mangaDexId],
    queryFn: () => getChapterFeed(manga.mangaDexId!, 'en', 96),
    enabled: !!manga.mangaDexId && !isCompleted && latestChapter != null,
    staleTime: 10 * 60 * 1000,
  })

  // Find the next unread chapter ID (sorted ascending so we get the closest match)
  const nextChapterId = useMemo(() => {
    if (!chaptersData?.chapters || latestChapter == null) return null
    const target = latestChapter + 1
    const sorted = [...chaptersData.chapters].sort(
      (a, b) => parseFloat(a.chapter) - parseFloat(b.chapter),
    )
    return sorted.find((ch) => {
      const num = parseFloat(ch.chapter)
      return !isNaN(num) && num >= target
    })?.id ?? null
  }, [chaptersData, latestChapter])

  const continueUrl = nextChapterId && manga.mangaDexId
    ? `/manga/read/${nextChapterId}?manga=${manga.mangaDexId}&malId=${manga.mal_id}`
    : `/manga/${manga.mal_id}`

  const chaptersLoading = !!manga.mangaDexId && !isCompleted && latestChapter != null && !chaptersData && !chaptersError

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="glass-card rounded-xl overflow-hidden group"
    >
      <div className="flex items-center gap-4 p-3">
        {/* Cover */}
        <Link
          to={`/manga/${manga.mal_id}`}
          className="shrink-0 w-12 h-16 rounded-lg overflow-hidden bg-white/[0.04] border border-white/5"
        >
          {manga.coverUrl ? (
            <img src={manga.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="h-full w-full grid place-items-center">
              <BookOpen className="h-4 w-4 text-white/10" />
            </div>
          )}
        </Link>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <Link
            to={`/manga/${manga.mal_id}`}
            className="text-sm font-semibold text-white hover:text-primary transition-colors line-clamp-1"
          >
            {manga.title_english || manga.title}
          </Link>
          <div className="flex items-center gap-2 mt-0.5">
            {isCompleted && (
              <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                <CheckCircle2 className="h-3 w-3" />
                Completed
              </span>
            )}
            {!isCompleted && readCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-primary font-semibold">
                <Clock className="h-3 w-3" />
                Reading
              </span>
            )}
            {readCount === 0 && (
              <span className="text-[10px] text-muted-foreground">Planning</span>
            )}
            <span className="text-[10px] text-white/30">
              {readCount}{total ? ` / ${total}` : ''} ch
            </span>
            {manga.format && (
              <span className="text-[10px] text-white/20 capitalize">{manga.format}</span>
            )}
          </div>

          {/* Progress bar */}
          {total && readCount > 0 && (
            <div className="mt-2 h-1 bg-white/[0.06] rounded-full overflow-hidden max-w-xs">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className={cn(
                  'h-full rounded-full',
                  isCompleted ? 'bg-emerald-500/70' : 'bg-primary/60',
                )}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!isCompleted && latestChapter != null && (
            chaptersLoading ? (
              <span className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-primary/5 text-white/30">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading
              </span>
            ) : (
              <Link
                to={continueUrl}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                <Play className="h-3 w-3" />
                Continue
              </Link>
            )
          )}
          {!isCompleted && latestChapter == null && readCount === 0 && (
            <span className="text-[10px] text-muted-foreground">Not started</span>
          )}
          <button
            onClick={onRemove}
            className="p-1.5 rounded-md text-white/45 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
            title="Remove from list"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}
