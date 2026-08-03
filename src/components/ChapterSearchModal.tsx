import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, ArrowDown, ArrowUp, Check, Hash, ArrowBigDown } from 'lucide-react'
import { cn } from '../lib/utils'

interface Chapter {
  id: string
  chapter: string
  title: string | null
  pages: number
  scanGroup: string | null
}

interface ChapterProgress {
  page: number
  totalPages: number
}

interface Props {
  open: boolean
  onClose: () => void
  chapters: Chapter[]
  currentChapterId: string | null
  onSelect: (ch: Chapter) => void
  /** Optional extra metadata to show alongside each chapter */
  isColoredChapter?: (ch: Chapter) => boolean
  isChapterRead?: (ch: Chapter) => boolean
  chapterProgress?: (ch: Chapter) => ChapterProgress | null
  coloredOnly?: boolean
  /** ID of the most recently read chapter — auto-scrolls to it on open */
  lastReadChapterId?: string | null
}

/** Full-screen chapter search/filter modal — replaces the small dropdown.
 *  Supports text search, sort order toggle, and bulk visual scanning. */
export default function ChapterSearchModal({
  open, onClose, chapters, currentChapterId, onSelect,
  isColoredChapter, isChapterRead, chapterProgress, coloredOnly,
  lastReadChapterId,
}: Props) {
  const [query, setQuery] = useState('')
  const [sortAsc, setSortAsc] = useState(false)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Reset search on open + scroll to last read chapter after mount
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlightedId(null)
      // Focus the search input after a short delay for the animation
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Auto-scroll to last read chapter when modal opens
  useEffect(() => {
    if (!open || !lastReadChapterId || chapters.length === 0) return
    // Wait for the grid to render, then scroll to the target card
    const timer = setTimeout(() => {
      const card = cardRefs.current.get(lastReadChapterId)
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedId(lastReadChapterId)
        // Clear highlight after 2s
        setTimeout(() => setHighlightedId(null), 2000)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [open, lastReadChapterId, chapters.length])

  // Manual jump-to-last-read handler
  const jumpToLastRead = () => {
    if (!lastReadChapterId) return
    setQuery('') // clear search so the target chapter is visible
    setTimeout(() => {
      const card = cardRefs.current.get(lastReadChapterId)
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedId(lastReadChapterId)
        setTimeout(() => setHighlightedId(null), 2000)
      }
    }, 100)
  }

  const filtered = useMemo(() => {
    let list = chapters
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(c =>
        c.chapter.includes(q) ||
        (c.title || '').toLowerCase().includes(q) ||
        (c.scanGroup || '').toLowerCase().includes(q)
      )
    }
    // Sort by chapter number
    const sorted = [...list].sort((a, b) => {
      const na = parseFloat(a.chapter)
      const nb = parseFloat(b.chapter)
      if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na
      return sortAsc
        ? a.chapter.localeCompare(b.chapter)
        : b.chapter.localeCompare(a.chapter)
    })
    return sorted
  }, [chapters, query, sortAsc])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 bg-black/90 flex flex-col"
          onClick={onClose}
        >
          {/* Header */}
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#0a0a0a]/95"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-sm font-bold text-white/80 flex-1">Chapters</h3>
            {lastReadChapterId && (
              <button
                onClick={jumpToLastRead}
                className="flex items-center gap-1 text-[11px] text-amber-400/70 hover:text-amber-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-amber-400/[0.06]"
                title="Jump to last read chapter"
              >
                <ArrowBigDown className="h-3.5 w-3.5" />
                Latest
              </button>
            )}
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="flex items-center gap-1.5 text-[11px] text-white/40 hover:text-white/60 transition-colors px-2 py-1.5 rounded-lg hover:bg-white/[0.04]"
              title={sortAsc ? 'Sort newest first' : 'Sort oldest first'}
            >
              {sortAsc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
              {sortAsc ? 'Oldest' : 'Newest'}
            </button>
          </motion.div>

          {/* Search bar */}
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.15, delay: 0.03 }}
            className="px-4 py-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 focus-within:border-primary/40 transition-all max-w-lg mx-auto">
              <Search className="h-4 w-4 text-white/25 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chapters by number, title, or scan group…"
                className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder:text-white/25"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-white/30 hover:text-white/60">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {coloredOnly && (
              <p className="text-[10px] text-amber-400/50 text-center mt-1.5">Filtering colored chapters only</p>
            )}
          </motion.div>

          {/* Chapter grid */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, delay: 0.06 }}
            data-lenis-prevent className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Search className="h-10 w-10 text-white/10 mx-auto mb-3" />
                <p className="text-sm text-white/30">
                  {chapters.length === 0 ? 'No chapters available' : `No chapters match "${query}"`}
                </p>
                {query && (
                  <button onClick={() => setQuery('')} className="text-xs text-primary hover:underline mt-2">
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 max-w-4xl mx-auto">
                {filtered.map((ch) => {
                  const isCurrent = ch.id === currentChapterId
                  const isColored = isColoredChapter?.(ch) ?? false
                  const isRead = isChapterRead?.(ch) ?? false
                  const isHighlighted = ch.id === highlightedId
                  const progress = chapterProgress?.(ch) ?? null
                  const progressPct = progress && progress.totalPages > 0
                    ? Math.min(Math.round((progress.page / progress.totalPages) * 100), 99)
                    : 0
                  const hasProgress = !isRead && progressPct > 0
                  return (
                    <button
                      key={ch.id}
                      ref={(el) => { if (el) cardRefs.current.set(ch.id, el); else cardRefs.current.delete(ch.id) }}
                      onClick={() => { onSelect(ch); onClose() }}
                      className={cn(
                        'flex flex-col gap-0.5 px-3 py-2.5 rounded-lg text-xs text-left transition-all border group',
                        isHighlighted && 'ring-2 ring-amber-400/60 animate-[pulse_1s_ease-in-out_2]',
                        isCurrent
                          ? 'bg-primary/15 border-primary/30 ring-1 ring-primary/20'
                          : isRead
                            ? 'bg-emerald-500/[0.06] border-emerald-500/15 hover:bg-emerald-500/[0.1] hover:border-emerald-500/25'
                            : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.06] hover:border-white/[0.1]',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={cn(
                          'font-semibold truncate flex-1',
                          isCurrent ? 'text-primary' : isRead ? 'text-emerald-400/70' : 'text-white/80',
                        )}>
                          Ch. {ch.chapter}
                        </span>
                        {isCurrent && <Check className="h-3 w-3 text-primary shrink-0" />}
                      </div>
                      {/* Partial-read progress bar */}
                      {hasProgress && (
                        <div className="h-[2px] w-full bg-white/[0.04] rounded-full mt-0.5 overflow-hidden">
                          <div
                            className="h-full bg-primary/50 rounded-full transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      )}
                      {ch.title && (
                        <span className="text-[10px] text-white/35 truncate">{ch.title}</span>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {isRead && <span className="text-[9px] text-emerald-400 font-semibold">✓ Read</span>}
                        {isColored && <span className="text-[9px] text-amber-400 font-semibold">🎨</span>}
                        {ch.scanGroup && (
                          <span className="text-[9px] text-primary/50 truncate">{ch.scanGroup}</span>
                        )}
                        {ch.pages > 0 && (
                          <span className="text-[9px] text-white/25 ml-auto flex items-center gap-0.5">
                            <Hash className="h-2.5 w-2.5" />
                            {ch.pages}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </motion.div>

          {/* Footer */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="px-4 py-2 border-t border-white/[0.04] bg-[#0a0a0a]/95 flex items-center justify-between"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-[10px] text-white/20">
              {filtered.length} chapter{filtered.length !== 1 ? 's' : ''}
              {query && ` matching "${query}"`}
            </span>
            <span className="text-[10px] text-white/15">Press Esc to close</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
