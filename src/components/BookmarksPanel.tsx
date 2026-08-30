import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Bookmark, Trash2, ArrowRight } from 'lucide-react'
import { useReaderStore } from '../store/useReaderStore'

interface Props {
  open: boolean
  onClose: () => void
  mangaId: string
  chapters: Array<{ id: string; chapter: string; title?: string | null }>
  currentChapterId: string | null
  onNavigateToPage: (pageIdx: number) => void
}

export default function BookmarksPanel({ open, onClose, mangaId, chapters, currentChapterId, onNavigateToPage }: Props) {
  const bookmarks = useReaderStore((s) => s.bookmarks?.[mangaId] || [])
  const removeBookmark = useReaderStore((s) => s.removeBookmark)

  // Enrich bookmarks with chapter info and sort by timestamp (newest first)
  const enriched = useMemo(() => {
    return bookmarks
      .map((bm) => {
        const ch = chapters.find((c) => c.id === bm.chapterId)
        return {
          ...bm,
          chapterTitle: ch?.title ?? null,
          isCurrentChapter: bm.chapterId === currentChapterId,
        }
      })
      .sort((a, b) => b.at - a.at)
  }, [bookmarks, chapters, currentChapterId])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[480px] max-h-[80vh] bg-[#0a0a0a]/98 border border-white/[0.06] rounded-2xl shadow-lg shadow-black/50 overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.04] shrink-0">
              <h3 className="text-sm font-bold text-white/80 flex items-center gap-2">
                <Bookmark className="h-4 w-4 text-primary" />
                Bookmarks
                {enriched.length > 0 && (
                  <span className="text-[10px] font-normal text-white/30 ml-1">
                    {enriched.length}
                  </span>
                )}
              </h3>
              <button onClick={onClose} className="text-white/45 hover:text-white transition-colors" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div data-lenis-prevent className="flex-1 overflow-y-auto custom-scrollbar p-4">
              {enriched.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Bookmark className="h-10 w-10 text-white/[0.06] mb-3" />
                  <p className="text-sm text-white/25">No bookmarks yet</p>
                  <p className="text-[11px] text-white/15 mt-1">
                    Press <kbd className="kbd-key">B</kbd> to bookmark the current page
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {enriched.map((bm) => (
                    <div
                      key={`${bm.chapterId}-${bm.pageIndex}`}
                      className={`group flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                        bm.isCurrentChapter
                          ? 'bg-primary/[0.04] border-primary/15 hover:border-primary/25'
                          : 'bg-white/[0.01] border-white/[0.04] hover:border-white/[0.08]'
                      }`}
                    >
                      {/* Thumbnail */}
                      <div className="w-16 h-10 shrink-0 rounded-md overflow-hidden bg-white/[0.03] border border-white/[0.04]">
                        <img
                          src={bm.thumbnailUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-white/70 truncate">
                            Ch. {bm.chapterNum}
                          </span>
                          <span className="text-[10px] text-white/25 font-mono">
                            Pg {bm.pageIndex + 1}
                          </span>
                          {bm.isCurrentChapter && (
                            <span className="glass-pill text-[9px] font-medium text-primary bg-primary/[0.06] border-primary/15 py-0.5 px-1.5">
                              Current
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {bm.chapterTitle && (
                            <span className="text-[10px] text-white/20 truncate">{bm.chapterTitle}</span>
                          )}
                          <span className="text-[9px] text-white/15 ml-auto">
                            {new Date(bm.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {/* Navigate to page */}
                        <button
                          onClick={() => {
                            onNavigateToPage(bm.pageIndex)
                            onClose()
                          }}
                          className="p-1.5 rounded-lg text-white/45 hover:text-primary hover:bg-primary/10 transition-colors"
                          title="Go to page"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => removeBookmark(mangaId, bm.chapterId, bm.pageIndex)}
                          className="p-1.5 rounded-lg text-white/45 hover:text-red-400 hover:bg-red-400/[0.1] transition-colors"
                          title="Remove bookmark"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer hint */}
            {enriched.length > 0 && (
              <div className="px-5 py-3 border-t border-white/[0.04] shrink-0">
                <p className="text-[10px] text-white/20 text-center">
                  Press <kbd className="kbd-key">B</kbd> to bookmark a page • Bookmarks are stored locally
                </p>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
