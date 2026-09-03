import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, Play } from 'lucide-react'
import { getImageUrl, formatScore, pickTitle } from '../lib/utils'
import { useSettings } from '../store/useSettings'
import type { Anime } from '../types'

interface Props {
  anime: Anime
  children: React.ReactNode
}

const HOVER_DELAY = 400
const LEAVE_DELAY = 200
const CARD_WIDTH = 320
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
    // (card ≈ 330px tall: banner 110 + title + meta + genres + synopsis + footer)
    const cardTop = rect.top > 0 ? rect.top - 20 : 0
    const top = Math.max(12, Math.min(cardTop, viewH - 360))

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
  const genres = anime.genres?.slice(0, 3) ?? []

  // Landscape banner for the header — trailer thumbnail (1280x720) when
  // available, else the poster stretched behind a gradient (still looks
  // intentional under the blur overlay).
  const bannerSrc =
    anime.trailer?.images?.maximum_image_url ||
    anime.trailer?.images?.large_image_url ||
    getImageUrl(anime)

  // Aniclover-style hover card: banner header with overlapping poster,
  // score • type • year meta row, genre pills, synopsis, details footer.
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
    >
      {children}
      {createPortal(hoverCard, document.body)}
    </div>
  )
}
