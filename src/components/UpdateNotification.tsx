import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Loader2, CheckCircle2, Download, Sparkles } from 'lucide-react'
import { cn } from '../lib/utils'

interface UpdateInfo {
  version: string
  releaseDate: string
}

interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

function formatBytes(b: number) {
  if (!b || b <= 0) return ''
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function formatSpeed(bps: number) {
  if (!bps || bps <= 0) return ''
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`
}

/**
 * Electron update dialog — a centered modal that appears when an update
 * is available on app startup.
 *
 * Flow:
 *   1. update-available → modal: "v0.1.1 is available" + Update / Later buttons
 *   2. Downloading automatically (electron-updater) → progress bar inside modal
 *   3. update-ready → modal: "Ready! Restart now to install"
 *
 * Only renders in Electron. In the browser it's a no-op.
 */
export default function UpdateNotification() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [phase, setPhase] = useState<'available' | 'downloading' | 'ready'>('available')
  const [show, setShow] = useState(false)
  const cleanupRefs = useRef<Array<() => void>>([])
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const api = window.electronAPI
    if (!api) return

    // When an update is found, show the modal immediately
    if (api.onUpdateAvailable) {
      const c1 = api.onUpdateAvailable((info: UpdateInfo) => {
        setUpdate(info)
        setShow(true)
        setPhase('available')
        // Transition to downloading if the download auto-starts before
        // the user clicks "Update" (electron-updater begins downloading
        // immediately after 'update-available' fires).
        pendingTimeout.current = setTimeout(() => {
          pendingTimeout.current = null
          setPhase((prev) => (prev === 'available' ? 'downloading' : prev))
        }, 2000)
      })
      cleanupRefs.current.push(c1)
    }

    // Download progress updates
    if (api.onUpdateProgress) {
      const c2 = api.onUpdateProgress((data: UpdateProgress) => {
        setProgress(data)
        setPhase('downloading')
        // Cancel the fallback timeout since we have real progress
        if (pendingTimeout.current) {
          clearTimeout(pendingTimeout.current)
          pendingTimeout.current = null
        }
      })
      cleanupRefs.current.push(c2)
    }

    // Update ready to install
    api.onUpdateReady((info: UpdateInfo) => {
      setUpdate(info)
      setPhase('ready')
      setProgress(null)
      setShow(true)
      // Cancel any pending timeout — update is already ready
      if (pendingTimeout.current) {
        clearTimeout(pendingTimeout.current)
        pendingTimeout.current = null
      }
    })

    return () => {
      api.removeUpdateReadyListener()
      cleanupRefs.current.forEach((fn) => fn())
      if (pendingTimeout.current) {
        clearTimeout(pendingTimeout.current)
        pendingTimeout.current = null
      }
    }
  }, [])

  const handleRestart = () => {
    window.electronAPI?.installUpdate()
  }

  const handleDismiss = () => {
    setShow(false)
  }

  return (
    <AnimatePresence>
      {show && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80"
            onClick={phase === 'ready' ? undefined : phase === 'available' ? undefined : handleDismiss}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="relative glass-card rounded-2xl border border-white/[0.08] p-6 max-w-sm w-full shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-start gap-4 mb-4">
              <div
                className={cn(
                  'shrink-0 w-12 h-12 rounded-xl flex items-center justify-center',
                  phase === 'ready'
                    ? 'bg-emerald-500/15'
                    : phase === 'downloading'
                      ? 'bg-indigo-500/15'
                      : 'bg-primary/15',
                )}
              >
                {phase === 'ready' ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                ) : phase === 'downloading' ? (
                  <Loader2 className="h-6 w-6 text-indigo-400 animate-spin" />
                ) : (
                  <Sparkles className="h-6 w-6 text-primary" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-white">
                  {phase === 'ready'
                    ? 'Update Ready'
                    : phase === 'downloading'
                      ? 'Downloading Update'
                      : 'Update Available'}
                </h3>
                {update && (
                  <p className="text-xs text-white/50 mt-0.5">
                    Kurōdo v{update.version}
                    {update.releaseDate &&
                      ` · ${new Date(update.releaseDate).toLocaleDateString()}`}
                  </p>
                )}
              </div>

              {/* Close button (only during downloading — available/ready phase use explicit buttons) */}
              {phase === 'downloading' && (
                <button
                  onClick={handleDismiss}
                  aria-label="Dismiss"
                  className="shrink-0 p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Body */}
            {phase === 'available' && (
              <div className="mb-5">
                <p className="text-sm text-white/60 leading-relaxed">
                  A new version of Kurōdo is available.{' '}
                  <span className="text-white/80">
                    The download starts automatically — only changed files
                    will be downloaded (delta update).
                  </span>
                </p>
              </div>
            )}

            {phase === 'downloading' && (
              <div className="mb-5 space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-indigo-300/80 font-semibold">
                      {progress?.percent ?? 0}%
                    </span>
                    <span className="text-[10px] text-white/30">
                      {progress?.bytesPerSecond
                        ? formatSpeed(progress.bytesPerSecond)
                        : 'Preparing…'}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(progress?.percent ?? 0, 100)}%` }}
                    />
                  </div>
                </div>

                {progress?.transferred != null && progress?.total != null && progress.total > 0 && (
                  <div className="flex items-center justify-between text-[10px] text-white/25 font-mono">
                    <span>{formatBytes(progress.transferred)} / {formatBytes(progress.total)}</span>
                    <span className="text-white/20">Delta update</span>
                  </div>
                )}

                <p className="text-[11px] text-white/40 leading-relaxed">
                  The app remains usable while the update downloads in the
                  background. You'll be prompted to restart when it's done.
                </p>
              </div>
            )}

            {phase === 'ready' && (
              <div className="mb-5">
                <p className="text-sm text-white/60 leading-relaxed">
                  Kurōdo v{update?.version} is ready to install.{' '}
                  Restart the app now to apply the update.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2">
              {phase === 'available' && (
                <>
                  <button
                    onClick={handleDismiss}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/[0.04] border border-white/10 text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-all"
                  >
                    Later
                  </button>
                  <button
                    onClick={() => setPhase('downloading')}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-all shadow-[0_4px_20px_-6px_hsl(var(--theme-primary-h),var(--theme-primary-s),var(--theme-primary-l),0.5)] flex items-center justify-center gap-2"
                  >
                    <Download className="h-4 w-4" />
                    Update
                  </button>
                </>
              )}

              {phase === 'downloading' && (
                <button
                  onClick={handleDismiss}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/[0.04] border border-white/10 text-white/50 hover:bg-white/[0.08] hover:text-white/70 transition-all"
                >
                  Continue in background
                </button>
              )}

              {phase === 'ready' && (
                <>
                  <button
                    onClick={handleDismiss}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/[0.04] border border-white/10 text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-all"
                  >
                    Later
                  </button>
                  <button
                    onClick={handleRestart}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-all shadow-[0_4px_20px_-6px_rgba(16,185,129,0.5)] flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Restart Now
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
