import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '../lib/utils'

interface Props {
  /** @deprecated kept for backward-compat; no longer rendered. */
  kicker?: string
  title: ReactNode
  subtitle?: string
  /** Optional pill rendered next to the title, e.g. "HOT" / "SEASONAL". */
  pill?: string
  pillTone?: 'primary' | 'accent' | 'hot' | 'seasonal' | 'top' | 'upcoming'
  /** "View all" target. Omits the link when not provided. */
  to?: string
  linkLabel?: string
  className?: string
}

/**
 * Anikage-style section header — accent tick + display-font title + an
 * optional status pill, with a plain "View All →" link on the right.
 */
export default function SectionHeader({
  title,
  subtitle,
  pill,
  pillTone = 'primary',
  to,
  linkLabel = 'View All',
  className,
}: Props) {
  return (
    <div className={cn('flex items-center justify-between gap-4 mb-4', className)}>
      <motion.div
        className="min-w-0"
        initial={{ opacity: 0, x: -8 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="kicker-bar shrink-0" aria-hidden />
          <h2 className="font-display text-lg sm:text-xl font-bold text-white truncate">
            {title}
          </h2>
          {pill && (
            <span
              className={cn(
                'shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border',
                pillTone === 'accent'
                  ? 'bg-accent/10 text-accent border-accent/25'
                  : pillTone === 'hot'
                    ? 'bg-red-500/15 text-red-400 border-red-500/25'
                  : pillTone === 'seasonal'
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                  : pillTone === 'top'
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                  : pillTone === 'upcoming'
                    ? 'bg-blue-500/15 text-blue-400 border-blue-500/25'
                  : 'bg-primary/10 text-primary border-primary/25',
              )}
            >
              {pill}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="mt-1 pl-[14px] text-[13px] text-white/40">{subtitle}</p>
        )}
      </motion.div>

      {to && (
        <Link
          to={to}
          className="group shrink-0 inline-flex items-center gap-0.5 text-[12px] font-semibold text-white/50 transition-colors duration-200 hover:text-white"
        >
          {linkLabel}
          <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  )
}
