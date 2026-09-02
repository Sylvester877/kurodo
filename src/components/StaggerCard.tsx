import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../store/useSettings'

interface Props {
  /** Zero-based index in the grid — drives the stagger delay. */
  index: number
  children: ReactNode
  /** Optional className applied to the motion wrapper. */
  className?: string
  /** Override the base stagger delay per card. Default 0.04s. */
  staggerMs?: number
  /** Override the animation duration. Default 0.15s. */
  duration?: number
}

/**
 * Wraps a grid child with a Framer Motion staggered enter animation.
 *
 * Each card fades in from below (y: 24 → 0) with an increasing delay
 * proportional to its index, creating a cascading reveal as the user
 * scrolls through a gallery.
 *
 * Uses `whileInView` with `once: true` so the animation only plays
 * the first time the card enters the viewport.
 *
 * Usage:
 * ```
 * {items.map((item, i) => (
 *   <StaggerCard key={item.id} index={i}>
 *     <AnimeCard anime={item} />
 *   </StaggerCard>
 * ))}
 * ```
 */
export default function StaggerCard({
  index,
  children,
  className,
  staggerMs = 12,
  duration = 0.15,
}: Props) {
  const { reduceQuality, reduceMotion } = useSettings(
    useShallow((s) => ({ reduceQuality: s.reduceQuality, reduceMotion: s.reduceMotion })),
  )

  if (reduceMotion) {
    return <div className={className}>{children}</div>
  }

  // Spring bounce disabled on iGPUs — spring physics are compositor-heavy
  // and can jitter at lower framerates.
  const useSpringBounce = !reduceQuality
  // NOTE: no filter/blur animation — animating blur re-rasterizes the card
  // every frame while it enters during scroll (compositor jank with grids of
  // cards). opacity+transform+scale only: all GPU-composited, zero repaint.
  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 10,
        scale: 0.98,
      }}
      whileInView={{
        opacity: 1,
        y: 0,
        scale: 1,
      }}
      // Pre-trigger 250px early — matches ScrollReveal. Cards animate just
      // before they enter the viewport so fast scrolling never shows a swarm
      // of mid-animation cards on screen.
      viewport={{ once: true, margin: '0px 0px 250px 0px', amount: 0.05 }}
      transition={{
        duration,
        delay: (index % 20) * (staggerMs / 1000),
        ease: [0.22, 1, 0.36, 1],
        // Spring bounce on scale — gives cards a subtle "pop" as they land.
        // Only scale uses spring; opacity/translate use the standard ease.
        // Skipped on iGPUs (reduceQuality) to avoid compositor jitter.
        ...(useSpringBounce
          ? {
              scale: {
                type: 'spring' as const,
                stiffness: 180,
                damping: 14,
                mass: 0.6,
              },
            }
          : {}),
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
