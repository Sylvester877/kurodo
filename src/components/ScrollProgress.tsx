import { motion, useScroll, useSpring } from 'framer-motion'
import { useSettings } from '../store/useSettings'

/**
 * ScrollProgress — a thin gradient progress bar fixed to the bottom of the
 * viewport that fills as the user scrolls down the page. Uses framer-motion's
 * useScroll + useSpring for buttery-smooth tracking synced with Lenis.
 *
 * Sits at z-[40] — above page content but below modals (z-[50]+) and
 * the top loading bar (z-[70]).
 * Hidden when reduceMotion is enabled (no decorative animations).
 */
export default function ScrollProgress() {
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  })

  if (reduceMotion) return null

  return (
    <motion.div
      className="fixed bottom-0 left-0 right-0 h-[2px] z-[40] pointer-events-none origin-left"
      style={{
        scaleX,
        background:
          'linear-gradient(90deg, var(--brand-pink) 0%, var(--brand-purple) 100%)',
        boxShadow: '0 0 8px hsl(var(--theme-primary-h) var(--theme-primary-s) var(--theme-primary-l) / 0.5)',
      }}
    />
  )
}
