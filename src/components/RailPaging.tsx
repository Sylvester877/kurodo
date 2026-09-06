import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Shared rail paging controls — used by every horizontal content rail
 * (Continue Watching, Continue Reading, Related Anime, Featured slider,
 * hero rail). Renders glass prev/next chevrons on md+ screens.
 */
export function RailArrows({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  return (
    <div className="hidden md:flex items-center gap-1.5">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Scroll rail back"
        className="grid place-items-center h-7 w-7 rounded-full border border-white/[0.08] bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.1] hover:border-white/[0.16] transition-all duration-150"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Scroll rail forward"
        className="grid place-items-center h-7 w-7 rounded-full border border-white/[0.08] bg-white/[0.04] text-white/60 hover:text-white hover:bg-white/[0.1] hover:border-white/[0.16] transition-all duration-150"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

/** Smooth-scroll the rail by ~85% of its visible width (min 320px). */
export function railNudge(el: HTMLElement | null, dir: 1 | -1) {
  if (!el) return
  const amount = Math.max(el.clientWidth * 0.85, 320)
  el.scrollBy({ left: dir * amount, behavior: 'smooth' })
}
