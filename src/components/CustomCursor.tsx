import { useEffect, useState } from 'react'
import { motion, useSpring, useMotionValue } from 'framer-motion'
import { useSettings } from '../store/useSettings'

/**
 * Premium custom cursor with a soft trailing glow.
 *
 * - Follows the mouse with spring physics (stiffness 500, damping 28).
 * - Expands and brightens when hovering clickable elements.
 * - Hidden on touch devices and when reduced motion is enabled.
 * - Uses mix-blend-mode for a subtle "spotlight" effect over content.
 */
export default function CustomCursor() {
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const reduceQuality = useSettings((s) => s.reduceQuality)
  const [isTouch, setIsTouch] = useState(false)
  const [hovering, setHovering] = useState(false)
  const cursorX = useMotionValue(-100)
  const cursorY = useMotionValue(-100)
  const springConfig = { stiffness: 500, damping: 28, mass: 0.5 }
  const x = useSpring(cursorX, springConfig)
  const y = useSpring(cursorY, springConfig)

  useEffect(() => {
    // Detect touch device — custom cursor is awkward on phones/tablets.
    const touchQuery = window.matchMedia('(pointer: coarse)')
    setIsTouch(touchQuery.matches)
    const onChange = (e: MediaQueryListEvent) => setIsTouch(e.matches)
    touchQuery.addEventListener('change', onChange)
    return () => touchQuery.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reduceMotion || isTouch) return
    const onMove = (e: MouseEvent) => {
      cursorX.set(e.clientX)
      cursorY.set(e.clientY)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [reduceMotion, isTouch, cursorX, cursorY])

  useEffect(() => {
    if (reduceMotion || isTouch) return
    const onOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target?.closest('a, button, [role="button"], input, textarea, select, [data-cursor-hover]')
      ) {
        setHovering(true)
      }
    }
    const onOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target?.closest('a, button, [role="button"], input, textarea, select, [data-cursor-hover]')
      ) {
        setHovering(false)
      }
    }
    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
    }
  }, [reduceMotion, isTouch])

  if (reduceMotion || isTouch || reduceQuality) return null

  return (
    <>
      {/* Main cursor dot */}
      <motion.div
        className="fixed top-0 left-0 pointer-events-none z-[9999] hidden md:block"
        style={{ x, y }}
      >
        <motion.div
          animate={{
            width: hovering ? 48 : 12,
            height: hovering ? 48 : 12,
            x: hovering ? -24 : -6,
            y: hovering ? -24 : -6,
            opacity: 1,
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="rounded-full border border-white/60 bg-white/20 backdrop-blur-sm shadow-[0_0_20px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.5)]"
        />
      </motion.div>
      {/* Soft trailing glow */}
      <motion.div
        className="fixed top-0 left-0 pointer-events-none z-[9998] hidden md:block mix-blend-screen"
        style={{ x, y }}
      >
        <motion.div
          animate={{
            width: hovering ? 80 : 40,
            height: hovering ? 80 : 40,
            x: hovering ? -40 : -20,
            y: hovering ? -40 : -20,
            opacity: hovering ? 0.25 : 0.12,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="rounded-full bg-primary blur-xl"
        />
      </motion.div>
    </>
  )
}
