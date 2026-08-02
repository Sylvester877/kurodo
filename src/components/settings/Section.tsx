import { type ReactNode } from 'react'
import { cn } from '../../lib/utils'

interface Props {
  icon?: ReactNode
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export default function Section({ icon, title, description, children, className }: Props) {
  return (
    <section className={cn('glass-card rounded-2xl p-5', className)}>
      <div className="flex items-center gap-2 mb-4">
        <span className="kicker-bar" />
        {icon && (
          <div className="h-8 w-8 rounded-lg bg-primary/15 border border-primary/20 grid place-items-center shrink-0">
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h2>
          {description && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
