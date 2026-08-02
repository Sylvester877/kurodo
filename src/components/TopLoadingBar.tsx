// Top-of-viewport loading bar — fills while React Query has anything in
// flight, plus a quick bump on every route change. Pure CSS, no NProgress.

import { useEffect, useRef, useState } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { useSettings } from '../store/useSettings'

const SETTLE_MS = 220        // fade-out duration when nothing's in flight
const ROUTE_BUMP_MS = 500    // how long the bar shows after a route change with no queries

export default function TopLoadingBar() {
  const fetching = useIsFetching()
  const location = useLocation()
  const reduceMotion = useSettings((s) => s.reduceMotion)

  // 0..100 = bar width. Null = bar hidden.
  const [progress, setProgress] = useState<number | null>(null)
  const trickleRef = useRef<number | null>(null)
  const fadeRef = useRef<number | null>(null)

  // Stop any running timers
  const stopTimers = () => {
    if (trickleRef.current != null) {
      window.clearInterval(trickleRef.current)
      trickleRef.current = null
    }
    if (fadeRef.current != null) {
      window.clearTimeout(fadeRef.current)
      fadeRef.current = null
    }
  }

  // ── Fetching state changes ──
  useEffect(() => {
    if (fetching > 0) {
      stopTimers()
      // Snap to ~25% then trickle slowly toward 90%
      setProgress((p) => (p == null || p < 25 ? 25 : p))
      trickleRef.current = window.setInterval(() => {
        setProgress((p) => {
          if (p == null) return 25
          if (p >= 90) return p
          // Trickle slows down as it approaches 90%
          const inc = Math.max(0.5, (90 - p) * 0.06)
          return Math.min(90, p + inc)
        })
      }, 200)
    } else if (progress != null) {
      // Nothing in flight: snap to 100% then fade out
      stopTimers()
      setProgress(100)
      fadeRef.current = window.setTimeout(() => {
        setProgress(null)
      }, SETTLE_MS)
    }
    return stopTimers
    // Stable refs: fetchCount from useIsFetching is derived from TanStack Query's
    // internal counter — it changes only when queries start/stop, not on every render.
    // Adding `progress` to deps would create a render loop (setProgress → re-render → setProgress).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetching])

  // ── Route changes ──
  // Even pages with no React Query usage should show some activity feedback.
  useEffect(() => {
    if (fetching > 0) return // already showing
    stopTimers()
    setProgress(40)
    fadeRef.current = window.setTimeout(() => {
      setProgress(100)
      window.setTimeout(() => setProgress(null), SETTLE_MS)
    }, ROUTE_BUMP_MS)
    return stopTimers
    // location.pathname is the stable route key from React Router — it changes only
    // on actual navigation. The `fetching` and `progress` checks are intentional guards
    // to avoid double-bumping when a route change also triggers React Query fetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  if (progress == null) return null

  return (
    <div
      role="progressbar"
      aria-label="Loading"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      className="fixed top-0 left-0 right-0 z-[70] h-[2px] pointer-events-none"
    >
      <div
        className="h-full bg-gradient-to-r from-primary via-accent to-primary"
        style={{
          width: `${progress}%`,
          transition: reduceMotion
            ? 'opacity 150ms'
            : 'width 200ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms',
          opacity: progress >= 100 ? 0 : 1,
          // Soft glow trailing edge
          boxShadow: '0 0 8px hsl(245 75% 60% / 0.6), 0 0 4px hsl(245 75% 60% / 0.4)',
        }}
      />
    </div>
  )
}
