import { motion, useScroll, useTransform } from 'framer-motion'
import { useSettings } from '../store/useSettings'

/**
 * HomePageParallax — subtle scroll-driven ambient background for the Home page.
 *
 * Three large blurred gradient blobs shift vertically at different speeds
 * as the user scrolls, creating a sense of depth behind the feed sections.
 * This is identical in principle to Hero.tsx's parallax backdrop, but
 * spans the full page below the hero.
 *
 * Each blob:
 *   - Blob 1 (theme primary): scrolls at 15% speed — slowest, deepest layer
 *   - Blob 2 (accent purple):  scrolls at 25% speed — middle layer
 *   - Blob 3 (brand pink):    scrolls at 35% speed — fastest, shallowest layer
 *
 * Uses proportional scrollYProgress (0–50% of page) so the effect adapts
 * to page height — works on both short and long pages.
 *
 * Disabled when reduceMotion or reduceQuality is on (no unnecessary GPU work).
 */
export default function HomePageParallax() {
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const reduceQuality = useSettings((s) => s.reduceQuality)

  // Track window scroll progress — proportional to page height
  const { scrollYProgress } = useScroll()

  // Each blob translates over the first 50% of page scroll at a different rate.
  // After 50%, blobs stay at their final position (the effect naturally fades).
  const blob1Y = useTransform(scrollYProgress, [0, 0.5], ['0%', '-12%'])
  const blob2Y = useTransform(scrollYProgress, [0, 0.5], ['0%', '-20%'])
  const blob3Y = useTransform(scrollYProgress, [0, 0.5], ['0%', '-28%'])

  if (reduceMotion || reduceQuality) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* Blob 1 — deep layer, theme-coloured, slowest drift */}
      <motion.div
        className="aurora-blob aurora-blob-1"
        style={{
          y: blob1Y,
          opacity: 0.12,
          top: '15%',
          left: '-10%',
          width: '55vw',
          height: '55vw',
          maxWidth: '800px',
          maxHeight: '800px',
        }}
      />

      {/* Blob 2 — mid layer, accent purple, medium drift */}
      <motion.div
        className="aurora-blob aurora-blob-2"
        style={{
          y: blob2Y,
          opacity: 0.10,
          top: '45%',
          right: '-12%',
          width: '45vw',
          height: '45vw',
          maxWidth: '650px',
          maxHeight: '650px',
        }}
      />

      {/* Blob 3 — shallow layer, brand pink, fastest drift */}
      <motion.div
        className="aurora-blob aurora-blob-3"
        style={{
          y: blob3Y,
          opacity: 0.08,
          top: '70%',
          left: '25%',
          width: '50vw',
          height: '50vw',
          maxWidth: '700px',
          maxHeight: '700px',
        }}
      />
    </div>
  )
}
