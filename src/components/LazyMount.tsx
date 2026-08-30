import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  /**
   * How far ahead of the viewport (px) the content should mount.
   * Default 1000px — content mounts roughly one screen before the user
   * reaches it, so its data fetches (AniList pacing is 400ms/req) have
   * time to land before the section scrolls into view.
   */
  rootMargin?: string
  /**
   * Approximate height (px) reserved while the content is hidden.
   *
   * Keeps the document tall enough that scroll restoration on back-nav
   * (`useScrollRestoration` → lenis.scrollTo) doesn't clamp to a shrunken
   * page and drop the user in the wrong spot. Removed once mounted.
   * Default 280px.
   */
  minHeight?: number
}

/**
 * LazyMount — defers mounting (and therefore rendering + data fetching)
 * of expensive children until they're about to enter the viewport.
 *
 * Why: the Home page mounts ~9 AniList-backed sections at once. AniList's
 * client paces requests 400ms apart, so that burst serializes ~3.5s before
 * the above-the-fold hero even gets its data. Deferring below-fold sections
 * cuts the initial burst to just the hero's queries → hero paints in ~1s.
 *
 * Uses one tiny IntersectionObserver per gate (disconnected after firing)
 * — negligible overhead, and content mounts ~1000px early so the reveal
 * animations in ScrollReveal still play normally when scrolled to.
 */
export default function LazyMount({
  children,
  className,
  rootMargin = '1000px 0px',
  minHeight = 280,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (show) return
    const el = ref.current
    // No IO support (or the element is already gone) → just mount.
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShow(true)
      return
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true)
          obs.disconnect()
        }
      },
      { rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [rootMargin, show])

  return (
    <div ref={ref} className={className} style={show ? undefined : { minHeight }}>
      {show ? children : null}
    </div>
  )
}
