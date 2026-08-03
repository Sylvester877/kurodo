import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, Clock, X } from 'lucide-react'
import {
  subscribePendingActivity,
  getPendingActivity,
  flushAllActivity,
  setActivityOptedOut,
  type PendingActivityEntry,
} from '../lib/sync'
import { useWatchListStore } from '../store/useWatchListStore'
import { useAuthStore } from '../store/useAuthStore'
import { useSettings } from '../store/useSettings'
import { toast } from './Toaster'
import { cn } from '../lib/utils'

/**
 * Floating chip (bottom-right) that surfaces buffered AniList activity
 * posts. Tells the user "your watch session is queued, ~42s until
 * auto-post" so they don't think nothing's happening.
 *
 * Behavior:
 *   - Hidden when there's nothing pending OR when the user is signed out
 *     OR when autoPostActivity is off in settings
 *   - Click → opens a popover summarizing each queued anime
 *   - "Post now" button flushes immediately
 *   - ✕ on a row dismisses just that anime (per-show opt-out via the
 *     existing setActivityOptedOut helper)
 *
 * Uses subscribePendingActivity to re-render in real time.
 */
export default function PendingActivityChip() {
  const [entries, setEntries] = useState<PendingActivityEntry[]>([])
  const [open, setOpen] = useState(false)
  const auth = useAuthStore((s) => s.auth)
  const autoPost = useSettings((s) => s.autoPostActivity)
  const watchlist = useWatchListStore((s) => s.watchlist)
  const continueWatching = useWatchListStore((s) => s.continueWatching)

  // Subscribe + tick once per second so the countdown stays fresh.
  useEffect(() => {
    const update = () => setEntries(getPendingActivity())
    update()
    const unsub = subscribePendingActivity(update)
    const tick = window.setInterval(update, 1000)
    return () => {
      if (typeof unsub === 'function') unsub()
      window.clearInterval(tick)
    }
  }, [])

  // Auto-collapse the popover when the buffer drains
  useEffect(() => {
    if (!entries?.length) setOpen(false)
  }, [entries?.length])

  // Don't render when there's nothing to show.
  if (!auth || !autoPost || !entries?.length) return null

  // Total queued episodes across all shows
  const totalEpisodes = entries.reduce((sum, e) => sum + (e.episodes?.length ?? 0), 0)

  // Find a friendly title for each pending entry
  const titleFor = (malId: number) => {
    const a =
      watchlist.find((x) => x.mal_id === malId) ??
      continueWatching.find((c) => c.anime.mal_id === malId)?.anime
    return a?.title_english || a?.title || `MAL #${malId}`
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 select-none">
      {/* Popover (above the chip) */}
      {open && (
        <div className="mb-2 w-[320px] max-w-[calc(100vw-2rem)] glass-card rounded-xl border border-white/10 shadow-2xl overflow-hidden animate-[fadeInUp_0.15s_ease]">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-white">Pending activity</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {entries.length} {entries.length === 1 ? 'show' : 'shows'} · {totalEpisodes} episodes
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-1 rounded-md text-white/50 hover:text-white hover:bg-white/5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div data-lenis-prevent className="max-h-[260px] overflow-y-auto custom-scrollbar">
            {entries.map((e) => (
              <PendingRow key={e.malId} entry={e} title={titleFor(e.malId)} />
            ))}
          </div>

          <div className="border-t border-white/5">
            <div className="px-3 py-2.5 flex items-center gap-2">
              <button
                onClick={() => {
                  flushAllActivity()
                  toast.info('Posting buffered activity to AniList…', 2500)
                  setOpen(false)
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-colors"
              >
                <Send className="h-3 w-3" />
                Post all now
              </button>
            </div>
            <Link
              to="/activity"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-[11px] text-center text-white/55 hover:text-white hover:bg-white/5 border-t border-white/5 transition-colors"
            >
              Open activity dashboard →
            </Link>
          </div>
        </div>
      )}

      {/* The chip itself */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-semibold transition-all',
          'bg-card/95 border border-primary/40 text-white backdrop-blur-md shadow-lg',
          'hover:bg-card hover:border-primary/60 hover:scale-[1.02]',
          open && 'ring-2 ring-primary/40',
        )}
      >
        <span className="relative grid place-items-center h-5 w-5 rounded-full bg-primary">
          <Clock className="h-3 w-3 text-white" />
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        </span>
        <span className="font-mono text-[11px] tabular-nums">
          {totalEpisodes}
        </span>
        <span className="hidden sm:inline">
          queued
        </span>
      </button>
    </div>
  )
}

function PendingRow({
  entry, title,
}: { entry: PendingActivityEntry; title: string }) {
  const setOptOut = () => {
    setActivityOptedOut(entry.malId, true)
    toast.info(`Won't post activity for "${title}"`, 3000)
  }

  // Format episode list — contiguous range vs scattered
  const min = entry.episodes[0]
  const max = entry.episodes[entry.episodes.length - 1]
  const isContiguous = entry.episodes.length === max - min + 1 && entry.episodes.length >= 2
  const epLabel = isContiguous
    ? `EP ${min}–${max}`
    : entry.episodes.length === 1
    ? `EP ${entry.episodes[0]}`
    : `EP ${entry.episodes.slice(0, 3).join(', ')}${entry.episodes.length > 3 ? '…' : ''}`

  const seconds = Math.ceil(entry.flushesInMs / 1000)
  const flushLabel =
    entry.episodes.length < 2
      ? 'skipped (only 1 ep)'
      : seconds <= 0
      ? 'posting…'
      : `posts in ${seconds}s`

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.03] transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-white truncate">{title}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          <span className="glass-pill text-[10px] font-mono text-accent border-accent/20 bg-accent/10 py-0.5 px-1.5">{epLabel}</span>
          <span className="text-white/30 mx-1.5">·</span>
          {flushLabel}
        </p>
      </div>
      <button
        onClick={setOptOut}
        aria-label={`Don't post activity for ${title}`}
        title="Stop posting this show's activity"
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md text-white/40 hover:text-red-300 hover:bg-red-500/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
