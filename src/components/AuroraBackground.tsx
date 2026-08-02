import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useSettings } from '../store/useSettings'

/**
 * AuroraBackground — a premium animated mesh gradient that renders behind
 * the entire app. Three large blurred radial gradient blobs drift slowly
 * across the viewport, creating the aurora/nebula aesthetic trending on
 * 21st.dev and awwwards in 2026.
 *
 * - GPU-composited: only transform + opacity animations
 * - Respects reduceMotion setting
 * - Fixed positioning — doesn't scroll
 * - Subtle opacity (0.15) so it doesn't distract from content
 */
export default function AuroraBackground() {
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  if (!mounted || reduceMotion) return null

  return (
    <div
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
      aria-hidden="true"
    >
      {/* Layer 1 — large purple blob drifting top-left ↔ bottom-right */}
      <motion.div
        className="aurora-blob aurora-blob-1"
        style={{ willChange: 'transform, opacity' }}
        animate={{
          x: ['-5%', '12%', '-8%', '5%', '-5%'],
          y: ['-8%', '15%', '25%', '-5%', '-8%'],
          scale: [1, 1.08, 0.95, 1.05, 1],
          opacity: [0.1, 0.18, 0.12, 0.16, 0.1],
        }}
        transition={{
          duration: 24,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Layer 2 — violet blob drifting right ↔ left */}
      <motion.div
        className="aurora-blob aurora-blob-2"
        style={{ willChange: 'transform, opacity' }}
        animate={{
          x: ['5%', '-10%', '3%', '-6%', '5%'],
          y: ['10%', '-12%', '8%', '20%', '10%'],
          scale: [0.95, 1.1, 1.02, 0.98, 0.95],
          opacity: [0.12, 0.16, 0.1, 0.14, 0.12],
        }}
        transition={{
          duration: 28,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Layer 3 — pink/purple blob drifting center */}
      <motion.div
        className="aurora-blob aurora-blob-3"
        style={{ willChange: 'transform, opacity' }}
        animate={{
          x: ['0%', '8%', '-5%', '3%', '0%'],
          y: ['0%', '-10%', '5%', '12%', '0%'],
          scale: [1.02, 0.96, 1.08, 0.98, 1.02],
          opacity: [0.1, 0.2, 0.14, 0.18, 0.1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Subtle noise/grain overlay on top of the gradient */}
      <div className="absolute inset-0 aurora-noise" />
    </div>
  )
}
