import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, BookOpen, Tv } from 'lucide-react'

interface Props {
  open: boolean
  type: 'manga' | 'anime'
  title: string
  malId?: number | null
  onConfirm: () => void
  onDecline: () => void
  onClose: () => void
}

// Per-manga/anime choice memory: "opted-out" means user said no
const STORAGE_KEY = 'kurodo-sync-choices'
function getSyncChoices(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  catch { return {} }
}
function setSyncChoice(key: string, optedIn: boolean) {
  const choices = getSyncChoices()
  choices[key] = optedIn
  localStorage.setItem(STORAGE_KEY, JSON.stringify(choices))
}

export function hasUserDeclinedSync(key: string): boolean {
  return getSyncChoices()[key] !== true
}

export function markUserOptedInSync(key: string) {
  setSyncChoice(key, true)
}

export function useSyncConfirm(malId: number | null | undefined, type: 'manga' | 'anime') {
  const [show, setShow] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<(() => void) | null>(null)

  const key = malId != null ? `${type}:${malId}` : null

  const checkAndPrompt = useCallback((onConfirmed: () => void) => {
    if (!key) { onConfirmed(); return }
    if (getSyncChoices()[key] === true) { onConfirmed(); return }
    // User hasn't opted in yet — show dialog
    setPendingConfirm(() => onConfirmed)
    setShow(true)
  }, [key])

  const handleConfirm = useCallback(() => {
    if (key) setSyncChoice(key, true)
    setShow(false)
    if (pendingConfirm) pendingConfirm()
  }, [key, pendingConfirm])

  const handleDecline = useCallback(() => {
    setShow(false)
    // Don't mark as opted-out explicitly; ask again next time
  }, [])

  return { show, checkAndPrompt, handleConfirm, handleDecline, setShow }
}

export default function SyncConfirmDialog({
  open, type, title, malId, onConfirm, onDecline, onClose,
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-35 flex items-center justify-center bg-black/55"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="mx-4 w-full max-w-sm rounded-2xl bg-[#141414] border border-white/[0.08] p-6 shadow-2xl"
          >
            <button
              onClick={onClose}
              className="absolute top-3 right-3 text-white/20 hover:text-white/50 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="text-center mb-5">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-3">
                {type === 'manga' ? (
                  <BookOpen className="h-6 w-6 text-primary" />
                ) : (
                  <Tv className="h-6 w-6 text-primary" />
                )}
              </div>
              <h3 className="text-base font-bold text-white mb-1">
                {type === 'manga' ? 'Start Reading?' : 'Add to Watching list?'}
              </h3>
              <p className="text-xs text-white/45 leading-relaxed">
                {type === 'manga'
                  ? <>Would you like to track <strong className="text-white/70">{title}</strong> on your AniList?</>
                  : <>Add <strong className="text-white/70">{title}</strong> to your Watching list and sync progress to AniList?</>
                }
                {malId == null && (
                  <span className="block mt-1 text-white/25">Sign in to AniList to sync your progress.</span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={onDecline}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold border border-white/[0.06] text-white/40 hover:text-white/70 hover:bg-white/[0.03] transition-colors"
              >
                No Thanks
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20 transition-colors"
              >
                Yes, Track It
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
