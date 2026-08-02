import { cn } from '../../lib/utils'

interface Props {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  /** Show current value as a pill on the right of the slider */
  showValue?: boolean
  /** Custom value formatter (e.g. `${v}px`, `${v}%`) */
  formatValue?: (v: number) => string
  /** Display min/max labels */
  showLabels?: boolean
  /** Label for the left-end (default: String(min)) */
  minLabel?: string
  /** Label for the right-end (default: String(max)) */
  maxLabel?: string
  className?: string
}

/** Custom styled slider — replaces all native <input type="range">.
 *  Dark glass-morphism track with primary fill, inline value pill. */
export default function CustomSlider({
  value, onChange, min, max, step = 1,
  showValue = true, formatValue, showLabels = true,
  minLabel, maxLabel, className,
}: Props) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  const displayVal = formatValue ? formatValue(value) : String(value)

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {showLabels && (
        <span className="text-[10px] text-white/25 font-mono w-5 text-right tabular-nums shrink-0">
          {minLabel ?? String(min)}
        </span>
      )}
      <div className="relative flex-1 h-6 flex items-center">
        <div className="absolute inset-y-0 left-0 right-0 flex items-center pointer-events-none">
          <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/50 rounded-full transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-6 appearance-none bg-transparent cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(0,0,0,0.4)]
            [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-white/20
            [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-white/20"
        />
      </div>
      {showLabels && (
        <span className="text-[10px] text-white/25 font-mono w-5 text-left tabular-nums shrink-0">
          {maxLabel ?? String(max)}
        </span>
      )}
      {showValue && (
        <span className="text-[11px] font-mono text-white/50 font-semibold min-w-[28px] text-right tabular-nums shrink-0">
          {displayVal}
        </span>
      )}
    </div>
  )
}
