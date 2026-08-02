import { cn } from '../../lib/utils'
import { type ReactNode } from 'react'

export interface PillOption<V extends string> {
  value: V
  label: string
  icon?: ReactNode
}

interface Props<V extends string> {
  value: V
  options: PillOption<V>[]
  onChange: (v: V) => void
  size?: 'xs' | 'sm' | 'md'
  className?: string
}

/** Pill-segmented control — replaces native <select> everywhere in reader settings.
 *  Dark glass-morphism style with primary accent for the active pill. */
export default function PillSegmented<V extends string>({
  value, options, onChange, size = 'sm', className,
}: Props<V>) {
  const sizeClasses = size === 'xs'
    ? 'px-2 py-1 text-[10px]'
    : size === 'sm'
      ? 'px-2.5 py-1.5 text-[11px]'
      : 'px-3 py-2 text-xs'

  return (
    <div className={cn(
      'flex rounded-lg bg-white/[0.04] border border-white/[0.06] overflow-hidden',
      className,
    )}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            sizeClasses,
            'font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap',
            'first:rounded-l-md last:rounded-r-md',
            value === opt.value
              ? 'bg-primary/20 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
              : 'text-white/35 hover:text-white/60 hover:bg-white/[0.03]',
          )}
          title={opt.label}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}
