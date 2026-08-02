import { useEffect } from 'react'
import { useLenis } from 'lenis/react'
import { useMotionValue } from 'framer-motion'

/**
 * Returns a framer-motion MotionValue that tracks Lenis scroll velocity.
 * Value is in pixels per second, damped slightly so it settles quickly.
 *
 * Use this for subtle scroll-velocity effects (e.g. skew, stretch) that
 * respond to how fast the user is scrolling. Always gate the visual
 * output behind reduceMotion / reduceQuality checks.
 */
export function useLenisVelocity() {
  const velocity = useMotionValue(0)
  const lenis = useLenis()

  useEffect(() => {
    if (!lenis) return
    const onScroll = ({ velocity: v }: { velocity: number }) => {
      velocity.set(v)
    }
    lenis.on('scroll', onScroll)
    return () => {
      lenis.off('scroll', onScroll)
    }
  }, [lenis, velocity])

  return velocity
}
