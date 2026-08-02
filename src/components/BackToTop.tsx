import { useState, useEffect, useMemo } from 'react'
import { ArrowUp } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export default function BackToTop() {
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 500)
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      const pct = docHeight > 0 ? window.scrollY / docHeight : 0
      setProgress(Math.max(0, Math.min(1, pct)))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const circumference = 2 * Math.PI * 18
  const dashOffset = useMemo(() => circumference * (1 - progress), [circumference, progress])

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.5, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.5, y: 8 }}
          transition={{ type: 'spring', stiffness: 400, damping: 22 }}
          whileHover={{ scale: 1.1, y: -2 }}
          whileTap={{ scale: 0.92 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="fixed bottom-6 right-6 z-50 h-11 w-11 rounded-full bg-primary/90 hover:bg-primary text-white grid place-items-center shadow-lg shadow-primary/30 border border-white/10"
        >
          {/* Scroll progress ring */}
          <svg className="absolute inset-0 h-full w-full -rotate-90 pointer-events-none" aria-hidden="true">
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              className="text-white/60 transition-all duration-150"
            />
          </svg>
          <ArrowUp className="h-5 w-5 relative z-10" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
