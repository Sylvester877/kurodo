import { useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../lib/utils'

interface Props {
  /** Total number of pages in the chapter */
  totalPages: number
  /** Current page index (0-based) */
  currentPage: number
  /** Progress percentage (0-100) for strip mode */
  progressPct: number
  /** Whether we're in strip mode */
  isStrip: boolean
  /** Page URLs for thumbnail previews */
  pageUrls: string[]
  /** Called when user scrubs to a specific page */
  onSeekToPage: (pageIndex: number) => void
  className?: string
}

/** Tachiyomi-style progress scrubbing: hover the progress bar to see
 *  a thumbnail preview of the page at that position, click to jump there. */
export default function ProgressScrubber({
  totalPages, currentPage, progressPct, isStrip, pageUrls, onSeekToPage, className,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const [hoverX, setHoverX] = useState<number | null>(null)

  const getPageFromX = useCallback((clientX: number) => {
    if (!barRef.current) return currentPage
    const rect = barRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return Math.min(Math.floor(x * totalPages), totalPages - 1)
  }, [totalPages, currentPage])

  const previewPage = hoverX != null ? getPageFromX(hoverX) : null
  const previewUrl = previewPage != null ? pageUrls[previewPage] : null

  const activePct = isStrip
    ? progressPct
    : totalPages > 1 ? ((currentPage + 1) / totalPages) * 100 : 0

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setHoverX(e.clientX)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setHoverX(null)
  }, [])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!barRef.current) return
    const page = getPageFromX(e.clientX)
    onSeekToPage(page)
  }, [getPageFromX, onSeekToPage])

  // Detect hover state for styling
  const isHovering = hoverX != null

  return (
    <div className={cn('relative group', className)}>
      {/* Progress bar */}
      <div
        ref={barRef}
        className="relative w-full cursor-pointer py-1"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      >
        <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full bg-primary/60 rounded-full transition-all duration-150"
            style={{ width: `${activePct}%` }}
          />
        </div>
        {/* Hover dot indicator */}
        {hoverX != null && barRef.current && (() => {
          const rect = barRef.current.getBoundingClientRect()
          const leftPct = ((hoverX - rect.left) / rect.width) * 100
          return (
            <div
              className="absolute top-0 h-full w-0.5 bg-white/60 rounded-full shadow-[0_0_6px_rgba(255,255,255,0.3)] transition-none"
              style={{ left: `${leftPct}%` }}
            />
          )
        })()}
      </div>

      {/* Hover thumbnail preview */}
      <AnimatePresence>
        {previewUrl && isHovering && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <div className="rounded-lg overflow-hidden border border-white/[0.08] shadow-lg shadow-black/50 bg-black/92">
              <img
                src={previewUrl}
                alt={`Page ${previewPage! + 1}`}
                className="h-24 w-auto object-cover max-w-[160px]"
              />
              <div className="text-center text-[10px] text-white/60 py-1 px-2">
                Page {previewPage! + 1} / {totalPages}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
