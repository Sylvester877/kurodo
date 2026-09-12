import { useState, useMemo, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Pin, Search, Settings2, MessageSquare, Check, Hash } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '../../lib/utils'
import { ReaderImage } from '../ReaderImage'

type Tab = 'chapters' | 'settings' | 'comments'

interface Chapter {
  id: string
  chapter: string
  title: string | null
  pages: number
  scanGroup: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  pinned: boolean
  onTogglePin: () => void
  mangaTitle: string
  mangaCover?: string
  chapters: Chapter[]
  currentChapterId: string | null
  onSelectChapter: (ch: Chapter) => void
  totalPages: number
  currentPage: number // 0-based
  pageUrls: string[]
  onJumpPage: (idx: number) => void
  activeTab: Tab
  onTab: (t: Tab) => void
  settingsSlot?: React.ReactNode
  commentsCount?: number
  isChapterRead?: (ch: Chapter) => boolean
  chapterProgress?: (ch: Chapter) => { page: number; totalPages: number } | null
}

export default function MangaDrawer({
  open,
  onClose,
  pinned,
  onTogglePin,
  mangaTitle,
  mangaCover,
  chapters,
  currentChapterId,
  onSelectChapter,
  totalPages,
  currentPage,
  pageUrls,
  onJumpPage,
  activeTab,
  onTab,
  settingsSlot,
  commentsCount,
  isChapterRead,
  chapterProgress,
}: Props) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    if (!q.trim()) return chapters
    const qq = q.toLowerCase()
    return chapters.filter((c) => c.chapter.includes(qq) || (c.title || '').toLowerCase().includes(qq))
  }, [chapters, q])

  // Page list — show thumbnails for current chapter (atsu style: Page 1…N)
  const pageList = useMemo(() => pageUrls.map((url, i) => ({ idx: i, url })), [pageUrls])

  // Virtualize chapter list when it's long (1000+ like One Piece). Falls
  // back to plain map under 120 items so small manga pay no overhead.
  const parentRef = useRef<HTMLDivElement>(null)
  const useVirtual = filtered.length > 120
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 10,
  })
  // Keep current chapter visible when drawer opens or filter changes
  useEffect(() => {
    if (!useVirtual || !open || filtered.length === 0) return
    const idx = filtered.findIndex((c) => c.id === currentChapterId)
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentChapterId])

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — hidden when pinned */}
          {!pinned && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
              onClick={onClose}
            />
          )}
          <motion.aside
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className={cn(
              'fixed top-0 right-0 bottom-0 z-50 flex flex-col w-[343px] max-w-[86vw]',
              'bg-[#0e131b] border-l border-white/[0.08] shadow-[-20px_0_60px_rgba(0,0,0,0.65)]',
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-3 border-b border-white/[0.06] shrink-0">
              {mangaCover ? (
                <img src={mangaCover} alt="" className="h-9 w-7 rounded-md object-cover border border-white/10 shrink-0" />
              ) : null}
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-white/90 truncate leading-tight">{mangaTitle}</div>
                <div className="text-[10px] text-white/35">{chapters.length} chapters · {totalPages} pages</div>
              </div>
              <button
                onClick={onTogglePin}
                title={pinned ? 'Unpin drawer' : 'Pin drawer'}
                className={cn(
                  'h-8 w-8 grid place-items-center rounded-lg border transition-colors',
                  pinned ? 'bg-primary/15 text-primary border-primary/20' : 'text-white/35 hover:text-white/70 border-white/10 hover:bg-white/[0.04]',
                )}
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={onClose}
                className="h-8 w-8 grid place-items-center rounded-lg text-white/35 hover:text-white hover:bg-white/[0.06] transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Tabs — atsu-style segmented */}
            <div className="flex items-center gap-1 px-2 py-2 border-b border-white/[0.04] shrink-0 bg-white/[0.015]">
              {([
                { id: 'chapters' as const, label: 'Chapters', icon: Hash },
                { id: 'settings' as const, label: 'Settings', icon: Settings2 },
                { id: 'comments' as const, label: `Comments${commentsCount ? ` (${commentsCount})` : ''}`, icon: MessageSquare },
              ]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTab(t.id)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition-all',
                    activeTab === t.id
                      ? 'bg-white/[0.07] text-white border border-white/10 shadow-sm'
                      : 'text-white/40 hover:text-white/70 hover:bg-white/[0.03] border border-transparent',
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {activeTab === 'chapters' && (
                <>
                  {/* Search */}
                  <div className="px-3 py-2 shrink-0">
                    <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2 focus-within:border-primary/30 focus-within:bg-white/[0.06] focus-within:ring-2 focus-within:ring-primary/10 transition-colors">
                      <Search className="h-3.5 w-3.5 text-white/25 shrink-0" />
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search chapter…"
                        className="flex-1 bg-transparent outline-none text-[12px] text-white placeholder:text-white/25"
                      />
                      {q && (
                        <button onClick={() => setQ('')} className="h-6 w-6 grid place-items-center rounded-full bg-white/[0.06] hover:bg-white/[0.10] text-white/30 hover:text-white/60 transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {useVirtual ? (
                    <>
                      <div ref={parentRef} data-lenis-prevent className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2">
                        {filtered.length === 0 ? (
                          <div className="text-center text-xs text-white/30 py-8">No chapters match “{q}”</div>
                        ) : (
                          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                            {rowVirtualizer.getVirtualItems().map((vr) => {
                              const ch = filtered[vr.index]
                              const isCurrent = ch.id === currentChapterId
                              const read = isChapterRead?.(ch) ?? false
                              const prog = chapterProgress?.(ch)
                              const pct = prog && prog.totalPages > 0 ? Math.min(Math.round((prog.page / prog.totalPages) * 100), 99) : 0
                              return (
                                <div
                                  key={ch.id}
                                  style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${vr.size}px`,
                                    transform: `translateY(${vr.start}px)`,
                                  }}
                                  className="py-[2px]"
                                >
                                  <button
                                    onClick={() => onSelectChapter(ch)}
                                    className={cn(
                                      'w-full text-left rounded-xl px-3 py-2.5 border transition-colors flex items-center gap-2 h-[40px]',
                                      isCurrent
                                        ? 'bg-primary/15 border-primary/30 text-white'
                                        : read
                                          ? 'bg-emerald-500/[0.05] border-emerald-500/15 hover:bg-emerald-500/[0.08] text-white/70'
                                          : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.05] text-white/75',
                                    )}
                                  >
                                    <span className="text-[11px] font-semibold flex-1 truncate">Ch. {ch.chapter}{ch.title ? ` — ${ch.title}` : ''}</span>
                                    {isCurrent && <Check className="h-3 w-3 text-primary shrink-0" />}
                                    {read && !isCurrent && <span className="text-[10px] text-emerald-400 font-semibold shrink-0">✓ Read</span>}
                                    {pct > 0 && !read && !isCurrent && (
                                      <span className="text-[10px] text-white/25 font-mono shrink-0">{pct}%</span>
                                    )}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      {pageList.length > 0 && (
                        <div className="shrink-0 border-t border-white/[0.04] pt-3 px-2 pb-3 max-h-[38%] overflow-y-auto custom-scrollbar">
                          <div className="text-[10px] font-semibold tracking-wider text-white/30 uppercase px-1 mb-2">
                            Pages — Ch. {chapters.find((c) => c.id === currentChapterId)?.chapter ?? ''}
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {pageList.map((p) => (
                              <button
                                key={p.idx}
                                onClick={() => onJumpPage(p.idx)}
                                className={cn(
                                  'group relative rounded-lg overflow-hidden border bg-black/40 aspect-[3/4]',
                                  p.idx === currentPage ? 'border-primary ring-1 ring-primary/30' : 'border-white/10 hover:border-white/20',
                                )}
                              >
                                <ReaderImage url={p.url} alt={`Page ${p.idx + 1}`} className="h-full w-full object-cover" loadingMethod="native" imgLoading="lazy" />
                                <span className="absolute bottom-1 left-1 rounded bg-black/70 text-[9px] font-mono text-white/80 px-1 py-0.5">
                                  {p.idx + 1}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div data-lenis-prevent className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3 space-y-3">
                      {/* Chapters */}
                      <div className="space-y-1">
                        {filtered.map((ch) => {
                          const isCurrent = ch.id === currentChapterId
                          const read = isChapterRead?.(ch) ?? false
                          const prog = chapterProgress?.(ch)
                          const pct = prog && prog.totalPages > 0 ? Math.min(Math.round((prog.page / prog.totalPages) * 100), 99) : 0
                          return (
                            <button
                              key={ch.id}
                              onClick={() => onSelectChapter(ch)}
                              className={cn(
                                'w-full text-left rounded-xl px-3 py-2.5 border transition-colors flex items-center gap-2',
                                isCurrent
                                  ? 'bg-primary/15 border-primary/30 text-white'
                                  : read
                                    ? 'bg-emerald-500/[0.05] border-emerald-500/15 hover:bg-emerald-500/[0.08] text-white/70'
                                    : 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.05] text-white/75',
                              )}
                            >
                              <span className="text-[11px] font-semibold flex-1 truncate">Ch. {ch.chapter}{ch.title ? ` — ${ch.title}` : ''}</span>
                              {isCurrent && <Check className="h-3 w-3 text-primary shrink-0" />}
                              {read && !isCurrent && <span className="text-[10px] text-emerald-400 font-semibold shrink-0">✓ Read</span>}
                              {pct > 0 && !read && !isCurrent && (
                                <span className="text-[10px] text-white/25 font-mono shrink-0">{pct}%</span>
                              )}
                            </button>
                          )
                        })}
                        {filtered.length === 0 && <div className="text-center text-xs text-white/30 py-8">No chapters match “{q}”</div>}
                      </div>

                      {/* Page thumbnails of current chapter — atsu vertical Page 1…N */}
                      {pageList.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold tracking-wider text-white/30 uppercase px-1 mb-2">
                            Pages — Ch. {chapters.find((c) => c.id === currentChapterId)?.chapter ?? ''}
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {pageList.map((p) => (
                              <button
                                key={p.idx}
                                onClick={() => onJumpPage(p.idx)}
                                className={cn(
                                  'group relative rounded-lg overflow-hidden border bg-black/40 aspect-[3/4]',
                                  p.idx === currentPage ? 'border-primary ring-1 ring-primary/30' : 'border-white/10 hover:border-white/20',
                                )}
                              >
                                <ReaderImage url={p.url} alt={`Page ${p.idx + 1}`} className="h-full w-full object-cover" loadingMethod="native" imgLoading="lazy" />
                                <span className="absolute bottom-1 left-1 rounded bg-black/70 text-[9px] font-mono text-white/80 px-1 py-0.5">
                                  {p.idx + 1}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {activeTab === 'settings' && (
                <div data-lenis-prevent className="flex-1 overflow-y-auto custom-scrollbar p-3">
                  {settingsSlot ?? <div className="text-xs text-white/30">No settings</div>}
                </div>
              )}

              {activeTab === 'comments' && (
                <div className="flex-1 flex flex-col min-h-0">
                  {commentsCount && commentsCount > 0 ? (
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                      <div className="text-[11px] font-semibold text-white/40">{commentsCount} comments</div>
                      {/* Real comments fetched here when backend is wired — empty-state is the polished fallback */}
                      <div className="text-[11px] text-white/25 py-6 text-center">Threaded comments arriving soon — replies + likes keep per-page discussion live.</div>
                    </div>
                  ) : (
                    <div className="flex-1 grid place-items-center p-6 text-center">
                      <div className="max-w-[240px]">
                        <div className="h-12 w-12 rounded-2xl bg-white/[0.04] border border-white/[0.06] grid place-items-center mx-auto mb-3">
                          <MessageSquare className="h-5 w-5 text-white/20" />
                        </div>
                        <div className="text-[13px] font-semibold text-white/60">No comments yet</div>
                        <div className="text-[11px] text-white/25 mt-1 leading-relaxed">Be the first to discuss Ch. {chapters.find((c) => c.id === currentChapterId)?.chapter ?? '—'}. Replies + reactions keep per-page threads live.</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
