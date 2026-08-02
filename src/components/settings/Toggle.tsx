import { cn } from '../../lib/utils'

interface Props {
  checked: boolean
  onChange: (v: boolean) => void
  ariaLabel?: string
}

export default function Toggle({ checked, onChange, ariaLabel }: Props) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors border',
        checked
          ? 'bg-primary border-primary shadow-[0_0_12px_-2px_hsl(245,75%,60%,0.5)]'
          : 'bg-white/8 border-white/10',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
          checked ? 'left-[22px]' : 'left-0.5',
        )}
      />
    </button>
  )
}
