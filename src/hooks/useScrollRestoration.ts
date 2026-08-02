import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useLenis } from 'lenis/react'

// Saves scroll position keyed by pathname so navigating back restores the
// exact position instead of starting from the top every time.  Uses a
// session-level Map so refreshes reset it (nobody wants a stale scroll
// position from yesterday).
//
// Scroll restoration routes through Lenis when available so it doesn't fight
// the smooth-scroll loop. Falls back to native window.scrollTo if Lenis has
// not mounted yet (e.g. very first render or SSR/Electron pre-load).

const positions = new Map<string, number>()
const SAVE_INTERVAL = 800

function getScrollY() {
  return window.scrollY
}

function restoreScroll(top: number, lenis: ReturnType<typeof useLenis>) {
  if (lenis) {
    // immediate: true prevents an animated scroll on route change, which
    // would feel sluggish and could conflict with page entrance animations.
    lenis.scrollTo(top, { immediate: true })
  } else {
    window.scrollTo({ top })
  }
}

export function useScrollRestoration() {
  const location = useLocation()
  const timerRef = useRef<number | null>(null)
  const lenis = useLenis()

  // Restore scroll position when the route changes.
  useEffect(() => {
    const saved = positions.get(location.pathname)
    if (saved != null) {
      // Use requestAnimationFrame so the DOM settles first.
      const raf = requestAnimationFrame(() => {
        restoreScroll(saved, lenis)
      })
      return () => cancelAnimationFrame(raf)
    } else {
      restoreScroll(0, lenis)
    }
  }, [location.pathname, lenis])

  // Save scroll position periodically + on unload.
  useEffect(() => {
    const save = () => {
      positions.set(location.pathname, getScrollY())
    }
    timerRef.current = window.setInterval(save, SAVE_INTERVAL)
    window.addEventListener('beforeunload', save)
    // Also save when the component unmounts (route leaving).
    return () => {
      save()
      if (timerRef.current != null) window.clearInterval(timerRef.current)
      window.removeEventListener('beforeunload', save)
    }
  }, [location.pathname])
}
