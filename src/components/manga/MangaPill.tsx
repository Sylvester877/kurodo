import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/utils'

interface Props {
  chapterLabel: string // e.g. "1.1"
  chapterTitle?: string | null // e.g. "Chapter 1193" title — shown on hover
  totalChapters?: number // e.g. 698 — mangafire shows / 698
  onPrev?: () => void
  onNext?: () => void
  canPrev: boolean
  canNext: boolean
  onOpenChapters: () => void
  pageLabel?: string // e.g. "12 / 34" — shown on mobile / as secondary
  className?: string
}

/**
 * Mangafire-style floating pill — centered top, backdrop-blur, tiny chevrons.
 * Clicking the center label opens the chapter drawer.
 * Mirrors .reader__pill from mangafire (≈177×42 at x1253 y10).
 */
export default function MangaPill({
  chapterLabel,
  chapterTitle,
  totalChapters,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onOpenChapters,
  pageLabel,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'fixed top-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 rounded-full',
        'bg-[#16202f]/95 backdrop-blur-xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.55),0_1px_0_rgba(255,255,255,0.06)_inset]',
        'px-1.5 py-1.5 select-none',
        className,
      )}
    >
      <button
        onClick={onPrev}
        disabled={!canPrev}
        aria-label="Previous chapter"
        className={cn(
          'h-7 w-7 grid place-items-center rounded-full transition-colors',
          canPrev ? 'text-white/60 hover:text-white hover:bg-white/[0.08]' : 'text-white/15 cursor-default',
        )}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>

      <button
        onClick={onOpenChapters}
        title={chapterTitle ? `Ch. ${chapterLabel} — ${chapterTitle}` : `Ch. ${chapterLabel}`}
        className="group relative flex items-center gap-2 rounded-full bg-white/[0.07] hover:bg-white/[0.11] active:bg-white/[0.09] border border-white/[0.05] px-[13px] py-[6px] transition-colors"
      >
        <span className="text-[12px] font-bold tracking-[-0.01em] leading-none text-white/90 group-hover:text-white">
          Ch. {chapterLabel}
          {totalChapters ? <span className="font-medium text-white/35 ml-1 tabular-nums">/ {totalChapters}</span> : null}
        </span>
        {pageLabel && (
          <>
            <span className="h-3 w-px bg-white/12 shrink-0" />
            <span className="text-[11px] font-medium font-mono text-white/45 tabular-nums leading-none">{pageLabel}</span>
          </>
        )}
        {chapterTitle && (
          <span className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/85 border border-white/10 px-2 py-1 text-[11px] font-medium text-white/70 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all duration-150 shadow-lg backdrop-blur">
            {chapterTitle.length > 42 ? chapterTitle.slice(0, 42) + '…' : chapterTitle}
          </span>
        )}
      </button>

      <button
        onClick={onNext}
        disabled={!canNext}
        aria-label="Next chapter"
        className={cn(
          'h-7 w-7 grid place-items-center rounded-full transition-colors',
          canNext ? 'text-white/60 hover:text-white hover:bg-white/[0.08]' : 'text-white/15 cursor-default',
        )}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
