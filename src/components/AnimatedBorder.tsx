import { type ReactNode } from 'react'
import { cn } from '../lib/utils'

interface Props {
  children: ReactNode
  className?: string
  /** Border width in px (default: 1.5) */
  borderWidth?: number
  /** Animation speed in seconds (default: 8) */
  speed?: number
  /** Colors for the gradient. Default: brand pink→purple→pink */
  colors?: [string, string, string]
  /** When true, only show border on hover */
  hoverOnly?: boolean
  /** Roundness: 'lg' (24px) | 'xl' (20px) | '2xl' (16px). Default: 'xl' */
  rounded?: 'lg' | 'xl' | '2xl'
}

const roundedMap = {
  lg: 'rounded-lg',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
}

/**
 * AnimatedBorder — wraps children with a conic-gradient border that
 * continuously rotates around the element, creating the premium
 * "animated gradient ring" effect trending on 21st.dev.
 *
 * Uses the `.ring-anim` CSS technique already in index.css (conic-gradient
 * with mask-composite for a border-only effect). GPU-composited —
 * only the border rotate animation runs, zero layout thrashing.
 *
 * Usage:
 *   <AnimatedBorder>
 *     <div className="glass-card p-6">Premium card</div>
 *   </AnimatedBorder>
 */
export default function AnimatedBorder({
  children,
  className,
  borderWidth = 1.5,
  speed = 8,
  colors,
  hoverOnly = false,
  rounded = 'xl',
}: Props) {
  const [c1, c2, c3] = colors ?? [
    'var(--brand-pink)',
    'var(--brand-purple)',
    'var(--brand-pink)',
  ]

  return (
    <div
      className={cn(
        'relative',
        hoverOnly && 'group/animated-border',
        className,
      )}
      style={{ isolation: 'isolate' }}
    >
      {/* Rotating gradient ring */}
      <div
        className={cn(
          'animated-border-ring absolute inset-0 pointer-events-none',
          roundedMap[rounded],
        )}
        style={{
          padding: `${borderWidth}px`,
          background: `conic-gradient(from 0deg, ${c1}, ${c2}, ${c3}, ${c1})`,
          mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          animation: `animatedBorderSpin ${speed}s linear infinite`,
          opacity: hoverOnly ? 0 : 1,
          transition: 'opacity 0.4s ease',
        }}
      />
      {/* Hover-only reveal via CSS group hover */}
      {hoverOnly && (
        <style>{`
          .group\\/animated-border:hover .animated-border-ring {
            opacity: 1 !important;
          }
        `}</style>
      )}

      {children}
    </div>
  )
}
