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
    const endIdx = Math.min(Math.floor((i + 1) * step) - 1, total - 1)
    const isVisited = pageIdx <= current
    const isActive = pageIdx === current || (current >= pageIdx && current < pageIdx + step)
    const label = segCount < total ? `Pages ${pageIdx + 1}–${Math.max(pageIdx + 1, endIdx + 1)}` : `Page ${pageIdx + 1}`
    return { pageIdx, endIdx, isVisited, isActive, label }
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
            aria-label={s.label}
            title={s.label}
            className="group relative grid place-items-center h-[18px] w-8 shrink-0 cursor-pointer"
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
            {/* Hover tooltip — page range for sampled spine (mangafire parity) */}
            <span className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-black/85 border border-white/10 px-1.5 py-1 text-[10px] font-medium leading-none text-white/70 opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all duration-150 shadow-lg backdrop-blur hidden md:block">
              {s.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
