import type { HeatCell } from '../../lib/stats'
import { cn } from '../../lib/utils'

interface Props {
  cells: HeatCell[][]
}

/**
 * Color tiers — empty stays nearly invisible, intensity ramps to crimson.
 * Picked to be readable on the dark glass-card background.
 */
const TIER = [
  'bg-white/[0.04] hover:bg-white/[0.08]',
  'bg-primary/20 hover:bg-primary/30',
  'bg-primary/40 hover:bg-primary/55',
  'bg-primary/65 hover:bg-primary/80',
  'bg-primary hover:bg-primary',
]

const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']

export default function Heatmap({ cells }: Props) {
  const totalEps = cells.flat().reduce((s, c) => s + c.count, 0)
  const activeDays = cells.flat().filter((c) => c.count > 0).length

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-xs text-muted-foreground">
          <span className="text-white font-semibold">{totalEps}</span> episodes
          across <span className="text-white font-semibold">{activeDays}</span> days
        </p>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          Less
          {TIER.map((t, i) => (
            <span key={i} className={cn('h-2.5 w-2.5 rounded-sm', t)} aria-hidden />
          ))}
          More
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-2">
        <div className="flex flex-col gap-1 pr-1 shrink-0 justify-around text-[9px] text-muted-foreground font-mono">
          {DAY_LABELS.map((d, i) => (
            <span key={i} className="h-2.5 leading-none">{d}</span>
          ))}
        </div>
        {cells.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1 shrink-0">
            {week.map((cell, di) => (
              <div
                key={di}
                title={`${cell.iso} · ${cell.count} episode${cell.count === 1 ? '' : 's'}`}
                className={cn(
                  'h-2.5 w-2.5 rounded-sm transition-colors',
                  TIER[cell.level],
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
