import { useMemo } from 'react'
import type { CountEntry } from '../../lib/stats'

interface Props {
  entries: CountEntry[]
}

// Curated palette: crimson, gold, then a spectrum that reads well on dark.
const PALETTE = [
  'hsl(245 75% 60%)', 'hsl(190 90% 50%)',  'hsl(180 70% 55%)',
  'hsl(264 75% 65%)', 'hsl(160 65% 50%)', 'hsl(28 90% 60%)',
  'hsl(210 80% 60%)', 'hsl(330 70% 65%)',
]

/**
 * Lightweight SVG donut. No chart library — keeps the bundle slim.
 * Renders nothing useful if entries is empty (returns a placeholder).
 */
export default function GenreDonut({ entries }: Props) {
  const total = entries.reduce((s, e) => s + e.count, 0)

  // Compute SVG arc segments
  const segments = useMemo(() => {
    if (total === 0) return []
    let acc = 0
    return entries.map((e, i) => {
      const start = acc / total
      acc += e.count
      const end = acc / total
      const color = PALETTE[i % PALETTE.length]
      return { ...e, start, end, color }
    })
  }, [entries, total])

  if (entries.length === 0) {
    return (
      <div className="grid place-items-center py-8 text-xs text-muted-foreground">
        Watch some episodes to see your genre breakdown
      </div>
    )
  }

  // SVG geometry
  const size = 180
  const r = 78
  const cx = size / 2
  const cy = size / 2

  // Arc path for a slice from `start` (0..1) to `end` (0..1)
  function arc(start: number, end: number): string {
    if (end - start >= 0.999) {
      // Full circle — use two arcs to avoid the degenerate case
      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`
    }
    const s = start * Math.PI * 2 - Math.PI / 2
    const e = end * Math.PI * 2 - Math.PI / 2
    const x1 = cx + r * Math.cos(s)
    const y1 = cy + r * Math.sin(s)
    const x2 = cx + r * Math.cos(e)
    const y2 = cy + r * Math.sin(e)
    const large = end - start > 0.5 ? 1 : 0
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
  }

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segments.map((s) => (
            <path
              key={s.key}
              d={arc(s.start, s.end)}
              fill={s.color}
              opacity={0.92}
            >
              <title>{s.key}: {s.count} episodes ({s.pct.toFixed(0)}%)</title>
            </path>
          ))}
          {/* Donut hole */}
          <circle cx={cx} cy={cy} r={r * 0.55} fill="hsl(0 0% 7%)" />
        </svg>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <p className="text-2xl font-extrabold text-white leading-none">
              {entries.length}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mt-0.5">
              genres
            </p>
          </div>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 flex-1 min-w-0 w-full">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-2 min-w-0">
            <span
              className="h-2 w-2 rounded-sm shrink-0"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="text-xs text-white truncate flex-1">{s.key}</span>
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
              {s.pct.toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
