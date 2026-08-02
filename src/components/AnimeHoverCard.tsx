import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, Clock, Tv } from 'lucide-react'
import { getImageUrl, formatScore, pickTitle } from '../lib/utils'
import { useSettings } from '../store/useSettings'
import type { Anime } from '../types'

interface Props {
  anime: Anime
  children: React.ReactNode
}

const HOVER_DELAY = 400
const LEAVE_DELAY = 200
const CARD_WIDTH = 280
const CARD_MARGIN = 12

/**
 * A rich hover preview card that floats beside an AnimeCard, showing
 * synopsis, score, genres, studios, and metadata in a compact panel.
 *
 * Rendered via portal to document.body so it never gets clipped by
 * parent overflow containers (grids, horizontal rails).
 */
export default function AnimeHoverCard({ anime, children }: Props) {
  const [visible, setVisible] = useState(false)
  const [cardStyle, setCardStyle] = useState<React.CSSProperties | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const titleLang = useSettings((s) => s.titleLang)
  const displayTitle = pickTitle(anime, titleLang)

  const clearTimers = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
  }, [])

  const computePosition = useCallback((): React.CSSProperties | null => {
    if (!wrapperRef.current) return null
    // wrapper uses display:contents (no layout box), so use first child's rect.
    // Guard: if firstElementChild isn't rendered yet (e.g. React hasn't committed
    // the DOM), return null — don't flash the card at (0,0).
    const child = wrapperRef.current.firstElementChild as HTMLElement | null
    const rect = child?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null

    const viewW = window.innerWidth
    const viewH = window.innerHeight
    const totalW = CARD_WIDTH + CARD_MARGIN + 20
    const spaceRight = viewW - rect.right - 12
    const spaceLeft = rect.left - 12

    // Pick side: prefer right, then left, then center below
    let left: number
    if (spaceRight >= totalW) {
      left = rect.right + CARD_MARGIN
    } else if (spaceLeft >= totalW) {
      left = rect.left - CARD_WIDTH - CARD_MARGIN
    } else {
      left = Math.max(12, (viewW - CARD_WIDTH) / 2)
    }

    // Clamp top so card stays in viewport with 12px breathing room
    const cardTop = rect.top > 0 ? rect.top : 0
    const top = Math.max(12, Math.min(cardTop, viewH - 420))

    return {
      position: 'fixed',
      left,
      top,
      width: CARD_WIDTH,
      zIndex: 9999,
    }
  }, [])

  const onMouseEnter = useCallback(() => {
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
    hoverTimer.current = setTimeout(() => {
      const pos = computePosition()
      if (!pos) return // firstElementChild not ready yet — skip this frame
      setCardStyle(pos)
      setVisible(true)
    }, HOVER_DELAY)
  }, [computePosition])

  const onMouseLeave = useCallback(() => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
    leaveTimer.current = setTimeout(() => setVisible(false), LEAVE_DELAY)
  }, [])

  // Track scroll AND resize to keep the portal position in sync while visible
  useEffect(() => {
    if (!visible) return
    const update = () => {
      const pos = computePosition()
      if (pos) setCardStyle(pos)
    }
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [visible, computePosition])

  useEffect(() => clearTimers, [clearTimers])

  const synopsis = anime.synopsis
  const genres = anime.genres?.slice(0, 6) ?? []
  const studios = anime.studios?.slice(0, 2) ?? []

  const hoverCard = (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 4 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          style={cardStyle ?? undefined}
          onMouseEnter={() => {
            if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null }
          }}
          onMouseLeave={onMouseLeave}
        >
          <div className="rounded-2xl bg-zinc-900/98 border border-white/10 shadow-lg shadow-black/50 overflow-hidden relative">
            {/* Cover image strip */}
            <div className="relative h-32 overflow-hidden">
              <img
                src={getImageUrl(anime)}
                alt=""
                className="w-full h-full object-cover opacity-80"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/40 to-transparent" />
            </div>

            {/* Score badge */}
            {anime.score && (
              <div className="absolute top-3 right-3 glass-pill py-0.5 px-2 bg-black/70 border-white/10 text-xs font-bold text-white tabular-nums shadow-lg">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                <span>{formatScore(anime.score)}</span>
              </div>
            )}

            {/* Content */}
            <div className="p-4 pt-3 space-y-2.5">
              <h4 className="text-sm font-bold text-white leading-snug line-clamp-2">
                {displayTitle}
              </h4>

              {/* Meta row */}
              <div className="flex items-center gap-2 text-[10px] text-white/45 font-medium flex-wrap">
                {anime.type && (
                  <span className="flex items-center gap-1">
                    <Tv className="h-3 w-3" />{anime.type}
                  </span>
                )}
                {anime.episodes && <span>{anime.episodes} eps</span>}
                {anime.duration && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />{anime.duration}
                  </span>
                )}
                {anime.year && <span>{anime.year}</span>}
              </div>

              {/* Genres */}
              {genres.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {genres.map((g) => (
                    <span
                      key={g.mal_id}
                      className="glass-pill text-[9px] py-0.5 px-1.5"
                    >
                      {g.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Synopsis */}
              {synopsis && (
                <p className="text-[11px] text-white/55 leading-relaxed line-clamp-3">
                  {synopsis}
                </p>
              )}

              {/* Studios */}
              {studios.length > 0 && (
                <div className="flex items-center gap-1.5 pt-1 border-t border-white/[0.06]">
                  <span className="text-[9px] text-white/30 uppercase tracking-wider">Studio</span>
                  {studios.map((s) => (
                    <span key={s.mal_id} className="text-[10px] font-medium text-white/50">
                      {s.name}
                    </span>
                  ))}
                </div>
              )}
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
    >
      {children}
      {createPortal(hoverCard, document.body)}
    </div>
  )
}
