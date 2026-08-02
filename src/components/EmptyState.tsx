import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { cn } from '../lib/utils'

interface Props {
  icon: ReactNode
  title: string
  description: string
  /** Primary CTA rendered below the description */
  children?: ReactNode
  className?: string
  /** When true, adds a subtle animated entry */
  animated?: boolean
}

/**
 * Premium empty state with an icon, title, description, and CTA.
 * Used by WatchList, Continue Watching, Search results — any place
 * where we show "nothing here yet" to the user.
 */
export default function EmptyState({
  icon,
  title,
  description,
  children,
  className,
  animated = true,
}: Props) {
  const Wrapper = animated ? motion.div : 'div'
  const animProps = animated
    ? {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.45, ease: [0.23, 1, 0.32, 1] },
      }
    : {}

  return (
    <Wrapper
      {...animProps}
      className={cn(
        'flex flex-col items-center justify-center py-16 px-6 text-center',
        className,
      )}
    >
      {/* Icon ring with animated glow */}
      <div className="relative mb-5">
        <div className="h-20 w-20 rounded-2xl bg-white/[0.03] border border-white/[0.06] grid place-items-center overflow-hidden">
          {/* Subtle shimmer sweep inside the icon container */}
          <div className="absolute inset-0 shimmer-v2" />
          <div className="relative text-white/20 [&_svg]:h-9 [&_svg]:w-9">
            {icon}
          </div>
        </div>
        {/* Pulsing glow behind the icon */}
        <div className="absolute inset-0 rounded-2xl bg-primary/10 blur-xl -z-10 animate-pulse" />
      </div>

      <h3 className="text-lg font-bold text-white mb-1.5">{title}</h3>
      <p className="text-sm text-white/40 max-w-sm leading-relaxed mb-6">
        {description}
      </p>

      {children && (
        <div className="flex items-center gap-3 flex-wrap justify-center">
          {children}
        </div>
      )}
    </Wrapper>
  )
}
