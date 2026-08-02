import { type ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface Props {
  icon?: ReactNode
  label: string
  value: ReactNode
  sub?: ReactNode
  accent?: 'primary' | 'accent' | 'emerald'
  className?: string
}

const ACCENT: Record<NonNullable<Props['accent']>, string> = {
  primary: 'from-primary/20 to-transparent border-primary/30',
  accent:  'from-accent/20 to-transparent border-accent/30',
  emerald: 'from-emerald-500/15 to-transparent border-emerald-500/25',
}

export default function StatTile({
  icon, label, value, sub, accent = 'primary', className,
}: Props) {
  return (
    <div className={cn(
      'glass-card rounded-2xl p-4 border bg-gradient-to-br',
      ACCENT[accent],
      className,
    )}>
      <div className="flex items-center gap-2 mb-2">
        {icon && <div className="opacity-80">{icon}</div>}
        <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="text-2xl sm:text-3xl font-extrabold text-white leading-none tracking-tight">
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-muted-foreground mt-2">{sub}</p>
      )}
    </div>
  )
}
