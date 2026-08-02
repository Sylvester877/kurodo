import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { cn } from '../lib/utils'

interface Props {
  className?: string
  style?: CSSProperties
  /** Roundness: 'sm' rounded-md, 'md' rounded-xl, 'full' rounded-full. */
  rounded?: 'sm' | 'md' | 'full' | 'none'
  /** When true, use the static glass-card background (no shimmer animation).
   *  Useful for users with `prefers-reduced-motion`. */
  static?: boolean
  /** Stagger delay in ms — cards appear sequentially for a premium reveal. */
  delay?: number
}

/**
 * Glass shimmer block — matches the glass-card aesthetic with a
 * gradient sweep animation for loading states. Uses the existing
 * `shimmer` keyframe from index.css.
 */
export function Skeleton({ className, style, rounded = 'md', static: isStatic, delay }: Props) {
  const [visible, setVisible] = useState(delay == null)
  useEffect(() => {
    if (delay == null) return
    const t = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(t)
  }, [delay])

  const r =
    rounded === 'full' ? 'rounded-full' :
    rounded === 'sm'   ? 'rounded-md'   :
    rounded === 'none' ? '' :
    'rounded-xl'
  return (
    <div
      role="presentation"
      aria-hidden
      style={{ ...style, opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease-out' }}
      className={cn(
        r,
        isStatic ? 'bg-card' : 'bg-white/[0.03] border border-white/[0.04] shimmer-wave',
        className,
      )}
    />
  )
}

/** Card placeholder (3:4 portrait poster + caption lines).
 *  Netflix-style progressive reveal with shimmer-wave animation.
 *  Supports staggered delay for premium progressive grid load. */
export function SkeletonCard({ className, delay }: { className?: string; delay?: number }) {
  return (
    <div
      className={cn('w-full', className)}
      style={delay != null ? { animationDelay: `${delay}ms` } : undefined}
    >
      {/* Poster with shimmer + subtle gradient depth */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl bg-white/[0.02] border border-white/[0.04] shimmer-wave">
        {/* Inner gradient for depth */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-transparent" />
        {/* Score badge placeholder */}
        <div className="absolute top-2 right-2 h-4 w-10 rounded-md bg-white/[0.05]" />
        {/* Status pill placeholder */}
        <div className="absolute top-2 left-2 h-4 w-14 rounded-md bg-white/[0.05]" />
        {/* Bottom gradient suggesting metadata area */}
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/30 to-transparent" />
      </div>
      {/* Caption lines */}
      <div className="mt-2.5 space-y-1.5 px-0.5">
        <div className="h-3 w-4/5 rounded-md bg-white/[0.04] shimmer-wave" />
        <div className="h-2.5 w-2/5 rounded-md bg-white/[0.03] shimmer-wave" />
      </div>
    </div>
  )
}

/** 16:9 episode-thumb / continue-watching card sized with shimmer. */
export function SkeletonThumb({ className }: { className?: string }) {
  return (
    <div className={cn('w-full', className)}>
      <div className="aspect-video w-full overflow-hidden rounded-2xl bg-white/[0.03] border border-white/[0.04] shimmer-wave" />
      <div className="mt-2 space-y-1.5">
        <div className="h-3 w-1/3 rounded-md bg-white/[0.04] shimmer-wave" />
        <div className="h-3.5 w-4/5 rounded-md bg-white/[0.04] shimmer-wave" />
      </div>
    </div>
  )
}

/** Row of N portrait card placeholders matching the standard 6-col grid. */
export function SkeletonRow({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}

/**
 * Staggered row — cards fade in one by one with 60ms stagger.
 * Netflix-style progressive reveal.
 */
export function SkeletonRowStaggered({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} delay={i * 60} />
      ))}
    </div>
  )
}

/** Horizontal scroller of 16:9 cards (used by Continue Watching, Recents). */
export function SkeletonScroller({
  count = 6,
  itemWidth = 240,
}: { count?: number; itemWidth?: number }) {
  return (
    <div className="flex gap-3 overflow-hidden pb-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ width: itemWidth }} className="shrink-0">
          <SkeletonThumb />
        </div>
      ))}
    </div>
  )
}

/**
 * Banner-shaped placeholder (used by AnimeDetails hero).
 */
export function SkeletonBanner() {
  return (
    <div className="relative">
      <Skeleton className="h-[40vh] min-h-[280px] w-full" rounded="none" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background to-transparent" />
      <div className="absolute bottom-6 left-6 right-6 max-w-3xl space-y-3">
        <Skeleton className="h-8 w-2/3" rounded="sm" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16" rounded="sm" />
          <Skeleton className="h-5 w-16" rounded="sm" />
          <Skeleton className="h-5 w-20" rounded="sm" />
        </div>
        <Skeleton className="h-3 w-4/5" rounded="sm" />
        <Skeleton className="h-3 w-3/5" rounded="sm" />
      </div>
    </div>
  )
}

/**
 * Settings / generic content placeholder — a stack of varying-width lines.
 */
export function SkeletonLines({
  count = 4,
  className,
}: { count?: number; className?: string }) {
  const widths = ['80%', '60%', '70%', '40%', '90%', '55%']
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          rounded="sm"
          className="h-3"
          style={{ width: widths[i % widths.length] }}
        />
      ))}
    </div>
  )
}
