import { cn } from '../../lib/utils'

interface Props {
  total: number
  current: number // 0-based index of current/highest-visible page
  onJump: (idx: number) => void
  // For strip mode the "visited" set is 0..current, for page mode just current is active
  className?: string
}

/**
 * Mangafire reader-progress--left clone: fixed 24px left rail with 3×15
 * tick segments. is-visited = dim, is-active = accent. Clickable + keyboard.
 */
export default function LeftProgressSpine({ total, current, onJump, className }: Props) {
  if (total <= 1) return null
  // Show at most 60 segments (mangafire caps at 60). For longer chapters
  // we sample evenly.
  const maxSegs = 60
  const step = total > maxSegs ? total / maxSegs : 1
  const segCount = Math.min(total, maxSegs)
  const segs = Array.from({ length: segCount }, (_, i) => {
    const pageIdx = Math.min(Math.floor(i * step), total - 1)
    const isVisited = pageIdx <= current
    const isActive = pageIdx === current || (current >= pageIdx && current < pageIdx + step)
    return { pageIdx, isVisited, isActive }
  })

  return (
    <div
      className={cn(
        'fixed left-0 top-0 bottom-0 z-30 hidden md:flex flex-col items-center justify-center gap-[2px] py-6',
        'w-8',
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total - 1}
      aria-valuenow={current}
      aria-label={`Page ${current + 1} of ${total}`}
    >
      <div className="flex flex-col items-center gap-[2px]">
        {segs.map((s, i) => (
          <button
            key={i}
            onClick={() => onJump(s.pageIdx)}
            aria-label={`Go to page ${s.pageIdx + 1}`}
            className="group grid place-items-center h-[18px] w-8 shrink-0 cursor-pointer"
          >
            <span
              className={cn(
                'block rounded-full transition-all duration-150',
                s.isActive
                  ? 'w-[3px] h-[18px] bg-[#6b7cff] shadow-[0_0_10px_rgba(107,124,255,0.7)]'
                  : s.isVisited
                    ? 'w-[3px] h-[14px] bg-white/30 group-hover:bg-white/50'
                    : 'w-[3px] h-[14px] bg-white/[0.09] group-hover:bg-white/25',
              )}
            />
          </button>
        ))}
      </div>
    </div>
  )
}
