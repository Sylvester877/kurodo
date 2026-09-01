import { cn } from '../lib/utils'

interface Option<V extends string> {
  value: V
  label: string
  /** Optional count badge shown to the right of the label. */
  count?: number
  /** Render this option as disabled. */
  disabled?: boolean
}

interface Props<V extends string> {
  value: V
  options: Option<V>[]
  onChange: (v: V) => void
  /** Accessible label for the radiogroup. */
  label?: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Reusable segmented-control pill group.
 *
 * Used for mutually-exclusive choices with a small number of options
 * (audio type, playback speed, video fit, settings preferences, etc.).
 * For longer lists, use a native `<select>` instead.
 */
export default function SegmentedControl<V extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  className,
}: Props<V>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl bg-white/[0.02] border border-white/[0.04] p-1',
        className,
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex items-center gap-1.5 rounded-lg font-semibold transition-all duration-200',
              size === 'sm' ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs',
              opt.disabled
                ? 'opacity-30 cursor-not-allowed text-white/30'
                : active
                  ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/20'
                  : 'text-white/70 hover:bg-white/5 hover:text-white',
            )}
          >
            <span>{opt.label}</span>
            {typeof opt.count === 'number' && (
              <span
                className={cn(
                  'text-[9px] font-mono px-1 rounded-md',
                  active ? 'bg-black/30 text-white' : 'bg-white/[0.06] text-white/65',
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
