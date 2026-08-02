import { useState, useEffect } from 'react'
import { WifiOff } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  )

  useEffect(() => {
    const goOffline = () => setOffline(true)
    const goOnline = () => setOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed top-[72px] left-0 right-0 z-[55] overflow-hidden"
        >
          <div
            role="alert"
            className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-500/90 text-amber-950 text-xs font-semibold"
          >
            <WifiOff className="h-3.5 w-3.5" />
            You're offline — some features may be limited
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
