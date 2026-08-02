import { cn } from '../../lib/utils'
import SegmentedControl from '../SegmentedControl'

interface Option<V extends string> {
  value: V
  label: string
}

interface Props<V extends string> {
  value: V
  options: Option<V>[]
  onChange: (v: V) => void
  size?: 'sm' | 'md'
}

export default function Select<V extends string>({
  value, options, onChange, size = 'md',
}: Props<V>) {
  // For a small number of options, the segmented control is faster to
  // scan and looks more premium than a native dropdown. Fall back to the
  // native select when the list is longer.
  if (options.length <= 4) {
    return (
      <SegmentedControl<V>
        value={value}
        options={options}
        onChange={onChange}
        size={size}
      />
    )
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as V)}
      className={cn(
        'rounded-lg bg-white/[0.04] text-white border border-white/10 focus:border-primary/50 focus:outline-none transition-colors appearance-none cursor-pointer pr-7',
        size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3 py-2',
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-card text-white">
          {o.label}
        </option>
      ))}
    </select>
  )
}
