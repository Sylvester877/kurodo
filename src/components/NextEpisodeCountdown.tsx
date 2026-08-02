import { useEffect, useState } from 'react'
import { Clock, Calendar } from 'lucide-react'

interface Props {
  /** Next-airing episode number. */
  episode: number
  /** UNIX timestamp in seconds when the episode airs. */
  airingAtSeconds: number
}

/** Format a number of seconds as "Nd Nh Nm Ns" (anidap-style). */
function formatCountdown(totalSeconds: number) {
  if (totalSeconds <= 0) return null
  const d = Math.floor(totalSeconds / 86400)
  const h = Math.floor((totalSeconds % 86400) / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0 || d > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

/**
 * Compact countdown bar shown beside the player when the show is currently
 * airing. Mirrors anidap's "Episode N is expected to be aired in …" message,
 * plus the absolute timestamp underneath.
 *
 * Self-contained: ticks once per second and hides itself if the air time
 * has already passed (so the host page doesn't need teardown logic).
 */
export default function NextEpisodeCountdown({ episode, airingAtSeconds }: Props) {
  const targetMs = airingAtSeconds * 1000
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((targetMs - Date.now()) / 1000)),
  )

  useEffect(() => {
    if (Date.now() >= targetMs) return
    const id = window.setInterval(() => {
      const next = Math.max(0, Math.floor((targetMs - Date.now()) / 1000))
      setRemaining(next)
      if (next <= 0) window.clearInterval(id)
    }, 1000)
    return () => window.clearInterval(id)
  }, [targetMs])

  if (remaining <= 0) return null

  // "Sunday, June 7, 2026 10:16 AM"
  const dateLabel = new Date(targetMs).toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="glass-card rounded-xl p-3 flex items-center gap-3 border border-primary/20 bg-gradient-to-r from-primary/[0.05] to-transparent">
      <div className="h-9 w-9 rounded-lg bg-primary/15 grid place-items-center shrink-0">
        <Clock className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-white/60 leading-tight">
          Episode <span className="text-white font-semibold">{episode}</span> is expected to air in
        </p>
        <p className="text-sm font-mono font-bold text-primary tabular-nums">
          {formatCountdown(remaining)}
        </p>
        <p className="text-[10px] text-muted-foreground/80 mt-0.5 flex items-center gap-1">
          <Calendar className="h-2.5 w-2.5" />
          {dateLabel}
        </p>
      </div>
    </div>
  )
}
