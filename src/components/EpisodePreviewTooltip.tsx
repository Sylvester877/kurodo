import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { Clock, CheckCircle2 } from 'lucide-react'
import { cn } from '../lib/utils'

interface Props {
  /** The trigger element (rendered as-is — wrap your button/link). */
  children: ReactNode
  episode: number
  title: string | null
  overview: string | null
  image: string | null
  durationMin?: number | null
  isCurrent?: boolean
  isWatched?: boolean
  /** Side the tooltip floats — auto-flips at viewport edges. */
  side?: 'left' | 'right'
  /** ms before showing (hover-intent so it doesn't flash on quick passes) */
  delayMs?: number
}

/**
 * Hover-to-preview tooltip for episode list items.
 *
 *   When you hover an episode card in the sidebar, after `delayMs`
 *   we float a card next to it with a larger thumbnail, the full
 *   title, the synopsis (clamped to 6 lines), and metadata badges.
 *
 *   Designed to position itself smartly:
 *   - Defaults to the side opposite the sidebar (`left` since the
 *     sidebar is on the right of the layout).
 *   - Flips to the other side automatically if it would clip the
 *     viewport.
 *   - Vertically centers on the trigger, but clamps to viewport.
 *
 *   Mobile: no hover-tooltip (touch users get the regular click flow).
 */
export default function EpisodePreviewTooltip({
  children, episode, title, overview, image,
  durationMin, isCurrent, isWatched,
  side = 'left', delayMs = 220,
}: Props) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; flipped: boolean } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)

  // Open on hover-intent.
  const onEnter = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      setOpen(true)
      compute()
    }, delayMs)
  }
  const onLeave = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = null
    setOpen(false)
  }

  // Compute & set coords. Flips side when the tooltip would clip the viewport.
  const compute = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const TOOLTIP_W = 340
    const GAP = 12
    let flipped = false
    let left: number
    if (side === 'left') {
      left = rect.left - TOOLTIP_W - GAP
      if (left < 8) {
        left = rect.right + GAP
        flipped = true
      }
    } else {
      left = rect.right + GAP
      if (left + TOOLTIP_W > window.innerWidth - 8) {
        left = rect.left - TOOLTIP_W - GAP
        flipped = true
      }
    }
    let top = rect.top
    const TOOLTIP_H = 280
    if (top + TOOLTIP_H > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - TOOLTIP_H - 8)
    }
    setCoords({ top, left, flipped })
  }, [side])

  // Reposition on window resize / scroll while open.
  useEffect(() => {
    if (!open) return
    const onRecalc = () => compute()
    window.addEventListener('resize', onRecalc)
    window.addEventListener('scroll', onRecalc, true)
    return () => {
      window.removeEventListener('resize', onRecalc)
      window.removeEventListener('scroll', onRecalc, true)
    }
    // compute() is stable via useCallback — only depends on `side`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, compute])

  // Suppress on touch devices — these users get the regular click flow.
  const isTouch = typeof window !== 'undefined' &&
    window.matchMedia?.('(pointer: coarse)').matches

  return (
    <div
      ref={triggerRef}
      onMouseEnter={isTouch ? undefined : onEnter}
      onMouseLeave={isTouch ? undefined : onLeave}
      className="contents"
    >
      {children}

      {open && coords && !isTouch && (
        <div
          role="tooltip"
          aria-hidden  /* purely decorative — title is already on the trigger */
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: 340,
            zIndex: 60,
          }}
          className={cn(
            'rounded-xl overflow-hidden bg-card/95 border border-white/10 shadow-lg',
            'animate-[fadeInUp_0.15s_ease]',
            'pointer-events-none',  /* don't block clicks on the underlying card */
          )}
        >
          {/* Hero image */}
          {image ? (
            <div className="relative aspect-video bg-black/60">
              <img
                src={image}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-card/95 via-transparent to-transparent" />
              <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between gap-2">
                <span className="glass-pill text-[11px] font-mono font-bold text-white bg-black/70 border-black/50 py-0.5 px-1.5">
                  EP {episode}
                </span>
                <div className="flex items-center gap-1.5">
                  {isCurrent && (
                    <span className="glass-pill text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/15 border-primary/30 py-0.5 px-1.5">
                      Playing
                    </span>
                  )}
                  {isWatched && !isCurrent && (
                    <span className="glass-pill text-[9px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/15 border-emerald-500/30 py-0.5 px-1.5">
                      <CheckCircle2 className="h-2.5 w-2.5" /> Watched
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-4 pt-3">
              <span className="font-mono text-[11px] font-bold text-primary">
                EP {episode}
              </span>
            </div>
          )}

          {/* Body */}
          <div className="p-3 space-y-2">
            <h4 className="text-sm font-bold text-white leading-tight line-clamp-2">
              {title || `Episode ${episode}`}
            </h4>

            {(durationMin || isCurrent || isWatched) && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {durationMin != null && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {durationMin}m
                  </span>
                )}
              </div>
            )}

            {overview && (
              <p className="text-[11px] text-white/65 leading-relaxed line-clamp-6">
                {overview}
              </p>
            )}

            {!overview && !image && (
              <p className="text-[11px] text-muted-foreground italic">
                No synopsis available for this episode.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
