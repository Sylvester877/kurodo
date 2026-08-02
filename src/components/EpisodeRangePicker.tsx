import { useRef, useEffect } from 'react'
import { cn } from '../lib/utils'

interface Props {
  totalEpisodes: number
  currentEp: number
  /** Optional override; default 25 per range (anidap convention). */
  rangeSize?: number
  /** Called when the user picks a new range. */
  onSelectRange: (start: number, end: number) => void
  activeRangeStart: number
}

/**
 * Anidap-style horizontal scrolling range tabs.
 *
 * Shows clickable glass pill tabs for each episode range. Active tab
 * gets the primary color fill. The active range auto-scrolls into view
 * on mount.
 */
export default function EpisodeRangePicker({
  totalEpisodes, currentEp, rangeSize = 25, onSelectRange, activeRangeStart,
}: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Auto-scroll the active range pill into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeRangeStart])

  // ALL hooks must be called before any early return.
  if (totalEpisodes <= rangeSize) return null

  // Build all ranges: [1-25], [26-50], ...
  const ranges: { start: number; end: number }[] = []
  for (let s = 1; s <= totalEpisodes; s += rangeSize) {
    ranges.push({ start: s, end: Math.min(s + rangeSize - 1, totalEpisodes) })
  }

  return (
    <div
      ref={rowRef}
      className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1 -mx-1 px-1"
      style={{ scrollbarWidth: 'thin' }}
    >
      {ranges.map((r) => {
        const isActive = r.start === activeRangeStart
        const isCurrentInRange = currentEp >= r.start && currentEp <= r.end
        return (
          <button
            key={r.start}
            ref={isActive ? activeRef : undefined}
            onClick={() => onSelectRange(r.start, r.end)}
            className={cn(
              'shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all whitespace-nowrap',
              'border',
              isActive
                ? 'bg-primary text-white border-primary shadow-[0_4px_14px_-4px_hsl(245,75%,60%,0.4)]'
                : 'glass-pill text-white/60 hover:text-white/90 hover:bg-white/[0.08]',
              isCurrentInRange && !isActive && 'border-primary/30',
            )}
          >
            {r.start}–{r.end}
          </button>
        )
      })}
    </div>
  )
}
