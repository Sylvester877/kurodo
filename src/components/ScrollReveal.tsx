import { type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../lib/utils'
import { useSettings } from '../store/useSettings'

interface Props {
  children: ReactNode
  className?: string
  /** Animation direction. Default: 'up' */
  direction?: 'up' | 'down' | 'left' | 'right'
  /** Stagger delay in seconds (for grid children). Default 0 */
  delay?: number
  /** When true, only animate once (default true) */
  once?: boolean
  /** Root margin for IntersectionObserver. Default '0px' */
  margin?: string
  /** Use a simpler fade-only animation (no slide). Default false */
  fadeOnly?: boolean
}

const directionMap = {
  up:    { y: 24, x: 0 },
  down:  { y: -24, x: 0 },
  left:  { x: 24, y: 0 },
  right: { x: -24, y: 0 },
}

/**
 * ScrollReveal — wraps children with framer-motion's whileInView, which
 * triggers a spring-based fade‑in + slide animation when the element
 * enters the viewport.
 *
 * Key advantages over the old manual useInView approach:
 *   • No flash of invisible content — elements already in the viewport
 *     on page load appear immediately (whileInView skips the animation).
 *   • No per-element IntersectionObserver overhead — framer‑motion
 *     batches observers internally.
 *   • Respects prefers‑reduced‑motion via CSS media query (index.css).
 *   • will‑change hint for GPU‑composited animations.
 */
export default function ScrollReveal({
  children,
  className,
  direction = 'up',
  delay = 0,
  once = true,
  margin = '0px',
  fadeOnly = false,
}: Props) {
  const { reduceMotion, reduceQuality } = useSettings(
    useShallow((s) => ({ reduceMotion: s.reduceMotion, reduceQuality: s.reduceQuality })),
  )

  // Skip scroll animations only when user explicitly prefers reduced motion.
  if (reduceMotion) {
    return <div className={cn(className)}>{children}</div>
  }

  const offset = fadeOnly ? { x: 0, y: 0 } : directionMap[direction]

  // Use variants to isolate from parent AnimatePresence opacity animation.
  // Add a subtle blur-to-sharp reveal on high-quality devices for a premium
  // 21st.dev feel; skip the blur on integrated GPUs / reduced quality.
  const variants = {
    hidden: {
      opacity: 0,
      ...offset,
      filter: reduceQuality ? 'none' : 'blur(4px)',
    },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      filter: 'blur(0px)',
    },
  }

  return (
    <motion.div
      className={cn(className)}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin, amount: 0.05 }}
      transition={{
        duration: 0.25,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </motion.div>
  )
}

/**
 * ScrollRevealGrid — wraps a grid of children and staggers their reveal
 * with a progressive delay. Each child fades in 12ms after the previous.
 *
 * Uses a single IntersectionObserver on the container rather than one
 * per child — much lighter on CPU, especially for 50+ card grids.
 *
 * Usage:
 *   <ScrollRevealGrid>
 *     {items.map(item => <AnimeCard key={item.id} anime={item} />)}
 *   </ScrollRevealGrid>
 */
export function ScrollRevealGrid({
  children,
  className,
  staggerMs = 12,
  direction = 'up',
  margin = '0px',
}: {
  children: ReactNode | ReactNode[]
  className?: string
  staggerMs?: number
  direction?: 'up' | 'down' | 'left' | 'right'
  margin?: string
}) {
  const reduceMotion = useSettings((s) => s.reduceMotion)

  // Skip scroll animations only when user explicitly prefers reduced motion.
  // reduceQuality is for GPU-heavy effects — scroll-triggered opacity/transform
  // animations are cheap on the compositor and should still run on iGPUs.
  if (reduceMotion) {
    return <div className={cn('contents', className)}>{children}</div>
  }

  const offset = directionMap[direction]
  const kids = Array.isArray(children) ? children : [children].filter(Boolean)

  // Variants isolate children from the parent AnimatePresence opacity
  // animation, preventing elements above the fold from getting stuck at
  // opacity: 0 when the page mounts.
  const variants = {
    hidden: { opacity: 0, ...offset },
    visible: { opacity: 1, x: 0, y: 0 },
  }

  return (
    <div className={cn('contents', className)}>
      {kids.map((child, i) => (
        <motion.div
          key={i}
          variants={variants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin, amount: 0.05 }}
          transition={{
            duration: 0.15,
            delay: (i % 20) * (staggerMs / 1000),
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          {child}
        </motion.div>
      ))}
    </div>
  )
}
