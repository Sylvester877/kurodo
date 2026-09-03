import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion'
import { Star, Play } from 'lucide-react'
import { getImageUrl, formatScore, pickTitle } from '../lib/utils'
import { useSettings } from '../store/useSettings'
import type { Anime } from '../types'

interface Props {
  anime: Anime
  children: React.ReactNode
}

const HOVER_DELAY = 350
const LEAVE_DELAY = 120
const CARD_WIDTH = 320

/**
 * Aniclover-style hover qtip: a fixed-position card that FOLLOWS THE CURSOR.
 *
 * Movement model (reverse-engineered from aniclover.cc's .anime-card-qtip):
 *  • position: fixed, pointer-events: none — it never intercepts the mouse
 *  • the card tracks the pointer with a spring so it glides behind movement
 *  • it sits to the right of the cursor, flipping left near the right edge,
 *    and clamps vertically inside the viewport
 *  • show/hide is a fast opacity fade (0.12s), no scale wobble
 *
 * Rendered via portal to document.body so it never gets clipped by parent
 * overflow containers (grids, horizontal rails).
 */
export default function AnimeHoverCard({ anime, children }: Props) {
  const [visible, setVisible] = useState(false)
  const [armed, setArmed] = useState(false) // gates rendering until first position
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const titleLang = useSettings((s) => s.titleLang)
  const displayTitle = pickTitle(anime, titleLang)

  // Spring-smoothed cursor position — snappy, near-1:1 tracking (aniclover's
  // qtip is effectively instant; this keeps a whisper of glide to smooth
  // hand-jitter without any perceivable lag). Settles in ~100ms, no wobble.
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const sx = useSpring(mx, { stiffness: 1100, damping: 55, mass: 0.45 })
  const sy = useSpring(my, { stiffness: 1100, damping: 55, mass: 0.45 })

  const clearTimers = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
  }, [])

  const track = useCallback((e: MouseEvent) => {
    const offset = 24 // card floats this far right of the cursor
    const w = CARD_WIDTH
    const h = 380 // approx card height; clamped below anyway
    let x = e.clientX + offset
    // flip to the left side when overflowing the right edge
    if (x + w > window.innerWidth - 12) x = e.clientX - w - offset
    // vertical clamp
    const y = Math.max(12, Math.min(e.clientY - 60, window.innerHeight - h - 12))
    mx.set(x)
    my.set(y)
  }, [mx, my])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    track(e.nativeEvent)
    if (!armed) setArmed(true)
  }, [track, armed])

  const onMouseEnter = useCallback((e: React.MouseEvent) => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
    track(e.nativeEvent)
    setArmed(true)
    hoverTimer.current = setTimeout(() => setVisible(true), HOVER_DELAY)
  }, [track])

  const onMouseLeave = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
    leaveTimer.current = setTimeout(() => {
      setVisible(false)
      setArmed(false)
    }, LEAVE_DELAY)
  }, [])

  useEffect(() => clearTimers, [clearTimers])

  const synopsis = anime.synopsis
  const genres = anime.genres?.slice(0, 3) ?? []

  const bannerSrc =
    anime.trailer?.images?.maximum_image_url ||
    anime.trailer?.images?.large_image_url ||
    getImageUrl(anime)

  const hoverCard = (
    <AnimatePresence>
      {visible && armed && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            left: sx,
            top: sy,
            width: CARD_WIDTH,
            zIndex: 9999,
            pointerEvents: 'none', // aniclover behavior: never intercept the cursor
          }}
        >
          <div className="rounded-2xl bg-zinc-900/[0.97] border border-white/10 shadow-2xl shadow-black/60 overflow-hidden relative backdrop-blur-xl">
            {/* ── Banner header with overlapping poster ── */}
            <div className="relative h-[110px]">
              <img
                src={bannerSrc}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => { e.currentTarget.style.opacity = '0' }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/35 to-transparent" />

              {/* Poster — overlaps the banner's bottom edge, aniclover-style */}
              <div className="absolute left-4 bottom-[-26px] h-[96px] w-[68px] rounded-xl overflow-hidden border-2 border-white/15 shadow-lg shadow-black/50 bg-zinc-800">
                <img
                  src={getImageUrl(anime)}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            </div>

            {/* ── Title sits right of the overlapping poster ── */}
            <div className="pl-[92px] pr-4 pt-2 min-h-[64px]">
              <h4 className="text-sm font-bold text-white leading-snug line-clamp-2">
                {displayTitle}
              </h4>
            </div>

            {/* ── Meta row: ★ score • type • year ── */}
            <div className="px-4 pt-1 flex items-center gap-1.5 text-xs text-white/60 font-medium">
              {anime.score && (
                <span className="flex items-center gap-1 text-white font-semibold">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {formatScore(anime.score)}
                </span>
              )}
              {anime.type && (
                <>
                  <span className="text-white/25">•</span>
                  <span>{anime.type}</span>
                </>
              )}
              {anime.year && (
                <>
                  <span className="text-white/25">•</span>
                  <span>{anime.year}</span>
                </>
              )}
              {anime.episodes && (
                <>
                  <span className="text-white/25">•</span>
                  <span>{anime.episodes} EP</span>
                </>
              )}
            </div>

            {/* ── Genre pills ── */}
            {genres.length > 0 && (
              <div className="px-4 pt-2.5 flex items-center gap-1.5 flex-wrap">
                {genres.map((g) => (
                  <span
                    key={g.mal_id}
                    className="text-[10px] font-medium text-white/75 border border-white/15 rounded-full px-2.5 py-0.5 bg-white/[0.03]"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            {/* ── Synopsis ── */}
            {synopsis && (
              <p className="px-4 pt-2.5 text-[11.5px] text-white/60 leading-relaxed line-clamp-4">
                {synopsis}
              </p>
            )}

            {/* ── Footer: click-through hint ── */}
            <div className="mt-3 px-4 py-2.5 border-t border-white/[0.07] flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-white/10 grid place-items-center">
                <Play className="h-2.5 w-2.5 fill-white text-white ml-px" />
              </span>
              <span className="text-xs font-medium text-white/70">Click to view details</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <div
      ref={wrapperRef}
      className="contents"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseMove={onMouseMove}
    >
      {children}
      {createPortal(hoverCard, document.body)}
    </div>
  )
}
