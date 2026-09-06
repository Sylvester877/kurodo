import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
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
 * Kurōdo section header — accent tick + Bricolage display title + optional
 * status pill, with a compact arrow-chip "View all" link on the right that
 * lights up and nudges on hover.
 */
export default function SectionHeader({
  title,
  subtitle,
  pill,
  pillTone = 'primary',
  to,
  linkLabel = 'View all',
  className,
}: Props) {
  return (
    <div className={cn('flex items-end justify-between gap-4 mb-4', className)}>
      <motion.div
        className="min-w-0"
        initial={{ opacity: 0, y: 6 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="kicker-bar shrink-0" aria-hidden />
          <h2 className="font-display text-[22px] sm:text-[26px] lg:text-[28px] font-bold tracking-tight text-white leading-none truncate">
            {title}
          </h2>
          {pill && (
            <span
              className={cn(
                'shrink-0 mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border',
                pillTone === 'accent'
                  ? 'bg-accent/10 text-accent border-accent/25'
                  : pillTone === 'hot'
                    ? 'bg-red-500/15 text-red-400 border-red-500/25 shadow-[0_0_14px_-4px_rgba(239,68,68,0.5)]'
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
          <p className="mt-2 pl-[15px] text-[13px] text-white/40 leading-relaxed">{subtitle}</p>
        )}
      </motion.div>

      {to && (
        <Link
          to={to}
          className="group shrink-0 inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] pl-3.5 pr-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/55 transition-all duration-200 hover:text-white hover:border-white/[0.16] hover:bg-white/[0.07]"
        >
          {linkLabel}
          <span className="grid place-items-center h-6 w-6 rounded-full bg-white/[0.06] text-white/70 transition-all duration-200 group-hover:bg-primary group-hover:text-white group-hover:shadow-[0_0_14px_-2px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.7)]">
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-px group-hover:-translate-y-px" />
          </span>
        </Link>
      )}
    </div>
  )
}
