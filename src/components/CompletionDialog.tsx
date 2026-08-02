import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, X, Sparkles, CheckCircle2 } from 'lucide-react'
import { cn } from '../lib/utils'
import { saveListEntry } from '../api/anilistAuth'
import { useAuthStore } from '../store/useAuthStore'
import { toast } from './Toaster'

interface CompletionEvent {
  malId: number
  aniId: number
  title: string
  totalEpisodes: number | null
}

/**
 * Completion dialog — shown when the user marks the last episode of an
 * anime as watched. Offers a 0-10 star rating before confirming the
 * COMPLETED status on AniList.
 *
 * Listens for the `kurodo:anime-completed` custom event dispatched by
 * sync.ts when it detects the final episode was watched.
 */
export default function CompletionDialog() {
  const [show, setShow] = useState(false)
  const [event, setEvent] = useState<CompletionEvent | null>(null)
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up dismiss timeout on unmount
  useEffect(() => {
    return () => {
      if (dismissRef.current) {
        clearTimeout(dismissRef.current)
        dismissRef.current = null
      }
    }
  }, [])

  const handleEvent = useCallback((e: Event) => {
    const detail = (e as CustomEvent).detail as CompletionEvent
    if (!detail || !detail.malId) return
    setEvent(detail)
    setRating(0)
    setHovered(0)
    setSubmitting(false)
    setDone(false)
    setShow(true)
  }, [])

  useEffect(() => {
    window.addEventListener('kurodo:anime-completed', handleEvent)
    return () => window.removeEventListener('kurodo:anime-completed', handleEvent)
  }, [handleEvent])

  const handleSubmit = async () => {
    const token = useAuthStore.getState().auth?.token
    if (!token || !event) return

    setSubmitting(true)
    try {
      // Save only the score — syncProgress already handled the COMPLETED
      // status and episode progress. AniList merges partial updates, so
      // omitting status/progress here avoids a redundant second API call.
      await saveListEntry(token, {
        mediaId: event.aniId,
        score: rating > 0 ? rating * 10 : undefined,
      })
      setDone(true)
      toast.success(`🎉 "${event.title}" completed!`)
    } catch (e) {
      console.warn('CompletionDialog: failed to save score', e)
      toast.error('Failed to save rating — but the show is still marked as completed.')
      setDone(true)
    } finally {
      setSubmitting(false)
      // Auto-dismiss after a moment (with cleanup)
      if (dismissRef.current) clearTimeout(dismissRef.current)
      dismissRef.current = setTimeout(() => {
        dismissRef.current = null
        setShow(false)
      }, 2000)
    }
  }

  const handleSkip = () => {
    setDone(true)
    if (dismissRef.current) clearTimeout(dismissRef.current)
    dismissRef.current = setTimeout(() => {
      dismissRef.current = null
      setShow(false)
    }, 800)
  }

  return (
    <AnimatePresence>
      {show && (
        <div className="fixed inset-0 z-[90] grid place-items-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80"
            onClick={() => !submitting && handleSkip()}
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
                  done ? 'bg-emerald-500/15' : 'bg-amber-500/15',
                )}
              >
                {done ? (
                  <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                ) : (
                  <Sparkles className="h-6 w-6 text-amber-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-white">
                  {done ? 'Completed!' : 'You finished it! 🎉'}
                </h3>
                <p className="text-xs text-white/50 mt-0.5 line-clamp-2">
                  {event?.title || 'This anime'}
                </p>
              </div>

              {!submitting && (
                <button
                  onClick={() => setShow(false)}
                  aria-label="Dismiss"
                  className="shrink-0 p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Body */}
            {!done && (
              <div className="mb-5 space-y-4">
                <p className="text-sm text-white/60 leading-relaxed">
                  Would you like to rate it before marking it as completed?
                </p>

                {/* Star rating picker */}
                <div className="flex items-center justify-center gap-1.5 py-2">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((star) => (
                    <button
                      key={star}
                      type="button"
                      disabled={submitting}
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHovered(star)}
                      onMouseLeave={() => setHovered(0)}
                      className="transition-transform hover:scale-110 active:scale-95 disabled:opacity-50"
                      aria-label={`Rate ${star} out of 10`}
                    >
                      <Star
                        className={cn(
                          'h-6 w-6 transition-colors',
                          (hovered || rating) >= star
                            ? 'text-amber-400 fill-amber-400'
                            : 'text-white/15',
                        )}
                      />
                    </button>
                  ))}
                </div>

                {rating > 0 && (
                  <p className="text-center text-sm font-semibold text-amber-400">
                    {rating}/10
                  </p>
                )}
              </div>
            )}

            {done && (
              <div className="mb-5">
                <p className="text-sm text-white/60 leading-relaxed text-center">
                  {rating > 0
                    ? `Rated ${rating}/10 · marked as completed on AniList`
                    : 'Marked as completed on AniList'}
                </p>
              </div>
            )}

            {/* Actions */}
            {!done && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSkip}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white/[0.04] border border-white/10 text-white/60 hover:bg-white/[0.08] hover:text-white/80 transition-all disabled:opacity-50"
                >
                  Skip
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-amber-500 text-black hover:bg-amber-400 transition-all shadow-[0_4px_20px_-6px_rgba(245,158,11,0.5)] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Star className="h-4 w-4" />
                  {submitting ? 'Saving…' : rating > 0 ? `Rate ${rating}/10` : 'Complete'}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
