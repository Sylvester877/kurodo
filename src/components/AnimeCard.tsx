import { memo, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { preloadHandlers } from '../lib/routePreloaders'
import { Star, Play } from 'lucide-react'
import { getImageUrl, formatScore, buildPosterSrcSet, pickTitle, getBackendOrigin } from '../lib/utils'
import { useSettings } from '../store/useSettings'
import { prefetchAnimeDetails, prefetchAnimeEpInfo } from '../lib/prefetch'
import AnimeHoverCard from './AnimeHoverCard'
import AnimeCardQuickActions from './AnimeCardQuickActions'
import MagneticCard from './MagneticCard'
import { ImageWithBlur } from './ImageWithBlur'
import type { Anime } from '../types'

interface Props {
  anime: Anime
  /** When set, overlays an "EP n" pill — used by Continue Watching row. */
  badge?: string
  /** Show a rich hover preview card with synopsis, genres, and score. Default true. */
  hoverPreview?: boolean
  /** Enable 3D magnetic tilt on hover. Default true — premium feel everywhere. */
  magnetic?: boolean
  /** Show quick add-to-watchlist button on hover. Default true. */
  quickActions?: boolean
}

export default memo(function AnimeCard({ anime, badge, hoverPreview = true, magnetic = true, quickActions = true }: Props) {
  const titleLang = useSettings((s) => s.titleLang)
  const displayTitle = pickTitle(anime, titleLang)
  // '' when the anime has no real poster (placeholder data-URL stubs or
  // missing images) — the card then shows a styled gradient + initial
  // instead of a broken "No Image" placeholder.
  const posterSrc = getImageUrl(anime)
  const [isHovered, setIsHovered] = useState(false)
  const cardRef = useRef<HTMLAnchorElement>(null)
  const [spotlight, setSpotlight] = useState({ x: 50, y: 50 })

  const onMouseEnter = useCallback(() => setIsHovered(true), [])
  const onMouseLeave = useCallback(() => setIsHovered(false), [])
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setSpotlight({ x, y })
  }, [])

  // ── IntersectionObserver: prefetch detail data when card nears viewport ──
  // Uses native lazy loading via loading="lazy" on images instead of per-card
  // observers. The hover/focus handler already prefetches epInfo on interaction,
  // which is more reliable and avoids creating 100+ observer instances per grid.
  // Kept a single lightweight observer just for viewport-warm prefetching
  // but only instantiated once per card via the ref+disconnect pattern.
  // Prefetch on hover/focus instead — more reliable than per-card IO observers

  // ── Status logic for unified pill ──────────────────────────────
  const isAiring = anime.status === 'Currently Airing' || anime.status === 'RELEASING'
  const isFinished = anime.status === 'Finished Airing' || anime.status === 'FINISHED'
  const isUpcoming = anime.status === 'Not yet aired' || anime.status === 'NOT_YET_RELEASED'

  const statusLabel = isUpcoming ? 'COMING SOON' : isAiring ? 'RELEASING' : isFinished ? 'FINISHED' : null

  // anikage-style: "TV • RELEASING" in a single pill
  const typePill = anime.type
    ? `${anime.type}${statusLabel ? ` \u2022 ${statusLabel}` : ''}`
    : statusLabel ?? null

  const pillTone = isUpcoming ? 'upcoming' : isAiring ? 'airing' : isFinished ? 'finished' : 'default'

  // ── Compact meta line under the title ──────────────────────────
  const metaParts: string[] = []
  if (anime.episodes) metaParts.push(`${anime.episodes} eps`)
  if (anime.year) metaParts.push(String(anime.year))
  if (anime.score) metaParts.push(`${formatScore(anime.score)} ★`)

  const cardContent = (
    <div>
      <Link
        ref={cardRef}
        to={`/anime/${anime.mal_id}`}
        state={{ anime }}
        {...preloadHandlers('/anime/x')}
        className="group block relative"
        onMouseEnter={() => {
          onMouseEnter()
          prefetchAnimeEpInfo(anime.mal_id)
          prefetchAnimeDetails(anime)
        }}
        onFocus={() => {
          prefetchAnimeEpInfo(anime.mal_id)
          prefetchAnimeDetails(anime)
        }}
        onMouseLeave={onMouseLeave}
        onMouseMove={onMouseMove}
      >
        {/* Spotlight glow that follows the cursor on hover */}
        <div
          className="absolute -inset-px rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-[3]"
          style={{
            background: `radial-gradient(circle at ${spotlight.x}% ${spotlight.y}%, hsl(var(--theme-primary-h) var(--theme-primary-s) var(--theme-primary-l) / 0.18), transparent 40%)`,
          }}
        />
        {/* ── Poster — clean anikage-style ── */}
        <div className="poster-frame aspect-[3/4] relative overflow-hidden">
          {/* Gradient fallback */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-primary/20 via-zinc-800 to-zinc-950"
          />
          {posterSrc ? (
          <ImageWithBlur
            src={posterSrc}
            alt={anime.title}
            lazy
            className="relative h-full w-full object-cover bg-zinc-900 transition-transform duration-300 group-hover:scale-103"
            srcSet={buildPosterSrcSet(posterSrc)}
            sizes="(min-width: 1280px) 220px, (min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
            placeholderBlur={12}
            fadeDuration={300}
            onError={(e) => {
              // ── Multi-tier fallback: try the /img card URL first, then
              // fade to transparency. This gives episodes without AniZip
              // images a numbered cover-based card instead of a grey box.
              const img = e.currentTarget
              if (!img.dataset.fallbackTried && anime.images?.webp?.large_image_url) {
                img.dataset.fallbackTried = '1'
                try {
                  const origin = getBackendOrigin()
                  img.src = `${origin}/img?card=1&url=${encodeURIComponent(anime.images.webp.large_image_url)}&ep=1`
                  return
                } catch { /* fall through */ }
              }
              img.style.opacity = '0'
            }}
          />
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <span className="text-white/20 font-black text-3xl select-none">
                {(anime.title_english || anime.title || '?').trim().charAt(0).toUpperCase()}
              </span>
            </div>
          )}

          {/* ── Top-right: ⭐ score ── */}
          {anime.score && !badge && (
            <div className="absolute top-2 right-2 z-[2] glass-pill py-0.5 px-1.5 bg-black/70 border-white/10 text-[9px] font-bold shadow-lg">
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              <span className="text-white">{formatScore(anime.score)}</span>
            </div>
          )}

          {/* ── Top-left: unified TYPE • STATUS pill ── */}
          <div className="absolute top-2 left-2 z-[2]">
            {badge ? (
              <div className="glass-pill py-0.5 px-2 bg-primary text-white text-[9px] font-bold uppercase tracking-wider shadow-lg">
                {badge}
              </div>
            ) : typePill ? (
              <div className={`glass-pill py-0.5 px-2 text-[9px] font-bold uppercase tracking-wider shadow-lg ${
                pillTone === 'airing'
                  ? 'bg-emerald-500/90 text-white border-emerald-400/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                  : pillTone === 'upcoming'
                    ? 'bg-blue-500/30 text-blue-200 border-blue-400/40'
                    : pillTone === 'finished'
                      ? 'bg-white/10 text-white/70 border-white/15'
                      : 'bg-white/10 text-white/80 border-white/15'
              }`}>
                {typePill}
              </div>
            ) : null}
          </div>

          {/* ── Hover: dark overlay + shine sweep + play button + quick actions ── */}
          <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            {/* Dark overlay with gradient for depth */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/65 to-black/80" />
            {/* Shine sweep — diagonal light streak on hover */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12" />
            </div>
            {/* Play button with pulsing ring */}
            <div className="relative h-11 w-11 rounded-full bg-primary/90 text-white flex items-center justify-center shadow-[0_0_20px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.6)] scale-75 group-hover:scale-100 transition-transform duration-200">
              <Play className="h-[18px] w-[18px] ml-0.5 fill-current" />
              {/* Pulsing ring — only animates on hover to avoid 50+ silent loops */}
              <div className="absolute inset-0 rounded-full border border-primary/40 opacity-0 group-hover:opacity-75 group-hover:animate-ping transition-opacity duration-300" />
            </div>
            {/* Quick add/remove watchlist button */}
            {quickActions && !badge && (
              <AnimeCardQuickActions anime={anime} visible={isHovered} />
            )}
          </div>
        </div>

        {/* ── Caption ── */}
        <div className="mt-2 px-0.5">
          <h3 className="text-[12px] font-semibold text-white/90 leading-snug line-clamp-2 transition-colors group-hover:text-white">
            {displayTitle}
          </h3>
          {metaParts.length > 0 && (
            <p className="text-[10px] text-white/30 uppercase tracking-[0.06em] font-medium truncate mt-0.5">
              {metaParts.join(' · ')}
            </p>
          )}
        </div>
      </Link>
    </div>
  )

  let result = cardContent

  if (hoverPreview && !badge) {
    result = <AnimeHoverCard anime={anime}>{result}</AnimeHoverCard>
  }

  if (magnetic && !badge) {
    result = <MagneticCard className="h-full">{result}</MagneticCard>
  }

  return result
// ── Prefetch epInfoQuery on hover/focus so anilistId is cached before
// the user reaches the details page. See lib/prefetch.ts.

}, (prev, next) =>
  prev.anime.mal_id === next.anime.mal_id &&
  prev.badge === next.badge &&
  prev.magnetic === next.magnetic &&
  prev.quickActions === next.quickActions &&
  prev.hoverPreview === next.hoverPreview &&
  prev.anime.images?.webp?.large_image_url === next.anime.images?.webp?.large_image_url)
