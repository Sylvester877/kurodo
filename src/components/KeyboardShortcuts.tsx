import { useEffect, useState, useCallback, useRef } from 'react'
import { X, Keyboard, SkipForward, SkipBack, Maximize2, Monitor } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'

const SHORTCUTS = [
  { keys: ['⌘', 'K'], label: 'Open search' },
  { keys: ['G', 'H'], label: 'Go home' },
  { keys: ['G', 'B'], label: 'Go to browse' },
  { keys: ['G', 'W'], label: 'Go to watchlist' },
  { keys: ['G', 'S'], label: 'Go to schedule' },
  { keys: ['?'], label: 'Toggle this help' },
  { keys: ['Esc'], label: 'Close modal / search' },
  { keys: ['N'], label: 'Next episode' },
  { keys: ['P'], label: 'Previous episode' },
  { keys: ['T'], label: 'Toggle theater mode' },
  { keys: ['F'], label: 'Toggle fullscreen' },
]

/** Subtle HUD toast — fades in top-right, auto-dismisses. */
function ShortcutHUD({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.95 }}
      className="fixed top-20 right-6 z-[90] glass-card rounded-xl px-4 py-2.5 flex items-center gap-2.5 shadow-2xl pointer-events-none"
    >
      <span className="text-primary">{icon}</span>
      <span className="text-xs font-semibold text-white">{label}</span>
    </motion.div>
  )
}

export default function KeyboardShortcuts() {
  const [open, setOpen] = useState(false)
  const [hud, setHud] = useState<{ icon: React.ReactNode; label: string } | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showHUD = useCallback((icon: React.ReactNode, label: string) => {
    // Clear any pending dismiss — prevents toast stacking on rapid key presses
    if (hudTimer.current) clearTimeout(hudTimer.current)
    setHud({ icon, label })
    hudTimer.current = setTimeout(() => {
      setHud(null)
      hudTimer.current = null
    }, 1800)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't fire inside inputs, textareas, or contenteditable
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return
      if (e.metaKey || e.ctrlKey) return

      if (e.key === '?') {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }

      if (e.key === 'Escape' && open) {
        setOpen(false)
        return
      }

      // ── Watch-page shortcuts (N/P/T/F) ───────────────────────
      const isWatchPage = location.pathname.startsWith('/watch/')
      if (isWatchPage) {
        if (e.key === 'n' || e.key === 'N') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kurodo:next-episode'))
          showHUD(<SkipForward className="h-3.5 w-3.5" />, 'Next Episode')
          return
        }
        if (e.key === 'p' || e.key === 'P') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kurodo:prev-episode'))
          showHUD(<SkipBack className="h-3.5 w-3.5" />, 'Previous Episode')
          return
        }
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kurodo:toggle-theater'))
          showHUD(<Monitor className="h-3.5 w-3.5" />, 'Theater Mode Toggled')
          return
        }
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('kurodo:toggle-fullscreen'))
          showHUD(<Maximize2 className="h-3.5 w-3.5" />, 'Fullscreen Toggled')
          return
        }
      }

      // G + letter navigation (google-style)
      if (e.key === 'g' && !open) {
        const handler = (e2: KeyboardEvent) => {
          window.removeEventListener('keydown', handler)
          // The SECOND keypress can land inside an input (user typing a
          // search) — never navigate away from a text field, and ignore
          // modifier combos.
          const t2 = (e2.target as HTMLElement)?.tagName
          if (t2 === 'INPUT' || t2 === 'TEXTAREA' || (e2.target as HTMLElement)?.isContentEditable) return
          if (e2.metaKey || e2.ctrlKey || e2.altKey) return
          if (e2.key === 'h') navigate('/')
          if (e2.key === 'b') navigate('/browse')
          if (e2.key === 'w') navigate('/watchlist')
          if (e2.key === 's') navigate('/schedule')
        }
        window.addEventListener('keydown', handler)
        setTimeout(() => window.removeEventListener('keydown', handler), 1500)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, navigate, location.pathname, showHUD])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-black/80 grid place-items-center p-4"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl glass-card p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold text-white">Keyboard Shortcuts</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/[0.04]"
                >
                  <span className="text-xs text-white/80">{s.label}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k, i) => (
                      <span key={i}>
                        <kbd className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded text-[10px] font-mono font-bold bg-white/10 border border-white/10 text-white/70">
                          {k}
                        </kbd>
                        {i < s.keys.length - 1 && (
                          <span className="text-[10px] text-white/30 mx-0.5">+</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-muted-foreground mt-4 text-center">
              Press <kbd className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-mono bg-white/10 border border-white/10 text-white/50">?</kbd> to toggle this help
            </p>
          </motion.div>
        </motion.div>
      )}

      {/* ── Shortcut HUD overlay ── */}
      <AnimatePresence>
        {hud && <ShortcutHUD icon={hud.icon} label={hud.label} />}
      </AnimatePresence>
    </AnimatePresence>
  )
}
