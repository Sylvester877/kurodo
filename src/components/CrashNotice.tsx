// B0-2: main-process crashes (uncaughtException / unhandledRejection) used to
// send 'app:crash' to the renderer, but NOTHING listened — the toast was
// dead code. This component subscribes via the preload's onCrash() bridge and
// shows a persistent error banner (auto-dismiss would hide the only hint the
// user has that something broke). The "View diagnostics" action deep-links to
// the /health page (renders server + app diagnostics verbatim, §4.6).
import { useState, useEffect } from 'react'
import { AlertTriangle, X, Activity } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

interface Crash {
  id: number
  message: string
}

let nextCrashId = 1

export default function CrashNotice() {
  const [crashes, setCrashes] = useState<Crash[]>([])
  const navigate = useNavigate()

  // Subscribe once. onCrash returns an unsubscribe fn (cleanup on unmount).
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onCrash) return
    return api.onCrash((message) => {
      const clean = (message || 'Unknown error').slice(0, 300)
      setCrashes((cur) => {
        // Avoid stacking identical spam from a crash loop — replace instead.
        const last = cur[cur.length - 1]
        if (last?.message === clean) return cur
        return [...cur.slice(-2), { id: nextCrashId++, message: clean }]
      })
      console.error('[main-process crash]', clean)
    })
  }, [])

  const dismiss = (id: number) =>
    setCrashes((cur) => cur.filter((c) => c.id !== id))

  if (crashes.length === 0) return null

  return (
    <AnimatePresence>
      {crashes.map((crash) => (
        <motion.div
          key={crash.id}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed top-[72px] left-0 right-0 z-[55] overflow-hidden"
        >
          <div
            role="alert"
            className="flex items-center gap-3 px-4 py-2.5 bg-red-950/90 border-b border-red-500/30 text-red-100 text-xs backdrop-blur"
          >
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
            <p className="flex-1 min-w-0 truncate leading-snug">
              <span className="font-bold text-red-300">App hiccup:</span>{' '}
              {crash.message}
            </p>
            <button
              onClick={() => navigate('/health')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/35 text-red-100 font-semibold transition-colors shrink-0"
            >
              <Activity className="h-3.5 w-3.5" />
              View diagnostics
            </button>
            <button
              onClick={() => dismiss(crash.id)}
              aria-label="Dismiss crash notice"
              className="text-red-300/70 hover:text-white transition-colors shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      ))}
    </AnimatePresence>
  )
}
