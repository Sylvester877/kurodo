import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Star, Calendar, Tv, Film, ChevronLeft, ChevronRight } from 'lucide-react'
import { getAllTimeTop } from '../api/anilist'
import SectionHeader from './SectionHeader'
import { preloadHandlers } from '../lib/routePreloaders'
import { proxifyImgUrl, cn } from '../lib/utils'

const PICK_AUTO_MS = 10000 // 10s between spotlight picks

const metaPill = 'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/45 backdrop-blur-md px-2.5 py-[5px] text-[11px] font-semibold text-white/80'
const metaIcon = 'h-3 w-3 text-white/55'

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

/**
 * Anikage-style "Featured Anime" spotlight — sits directly under the home
 * hero. The header row carries an "Editor's Pick" chip (as on anikage) and
 * the card is a big rounded banner spotlight that cycles through the
 * all-time community favorites (FMA:B leads it — the same #1 anikage shows).
 *
 * Data is shared with the Home "Most Favorite" grid (['feed','mostFavorite'])
 * so this section never fires its own AniList request.
 */
export default function FeaturedPicks() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['feed', 'mostFavorite'],
    queryFn: () => getAllTimeTop(18),
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })

  const picks = (data ?? [])
    .filter((m) => m.idMal && (m.bannerImage || m.coverImage.extraLarge || m.coverImage.large))
    .slice(0, 6)

  const current = picks[index] ?? null
  const title = current?.title.english || current?.title.romaji || ''
  const score = current?.averageScore != null ? Math.round(current.averageScore) : null

  // Auto-cycle; stop while hovering or when the user reduced motion.
  useEffect(() => {
    if (paused || picks.length <= 1) return
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setInterval(() => setIndex((i) => (i + 1) % picks.length), PICK_AUTO_MS)
    return () => window.clearInterval(t)
  }, [paused, picks.length])

  if (isLoading && picks.length === 0) {
    return (
      <section className="mx-3 sm:mx-4 mt-6 sm:mt-8">
        <div className="h-8 w-56 bg-white/[0.05] rounded shimmer mb-4" />
        <div className="h-[240px] bg-white/[0.03] border border-white/[0.04] rounded-[28px] shimmer" />
      </section>
    )
  }
  if (picks.length === 0) return null

  const goto = (i: number) => setIndex((i + picks.length) % picks.length)

  return (
    <section className="mx-3 sm:mx-4 mt-7 sm:mt-9">
      <SectionHeader
        title="Featured Anime"
        pill="EDITOR'S PICK"
        pillTone="top"
        subtitle="Hand-picked all-time favorites — the classics worth your time"
        linkLabel="Browse all"
        to="/browse?filter=top-rated"
      />

      {/* ── Spotlight card — anikage's big rounded banner ───────── */}
      <motion.div
        ref={wrapRef}
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className="relative group overflow-hidden rounded-[26px] sm:rounded-[30px] border border-white/[0.06] bg-surface select-none"
        style={{ height: 'clamp(210px, 26vw, 264px)' }}
      >
        {/* Background art — crossfades between picks */}
        <AnimatePresence>
          {current && (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0"
            >
              <img
                src={proxifyImgUrl(current.bannerImage || current.coverImage.extraLarge || current.coverImage.large || '')}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Readability gradients (left + bottom, anikage style) */}
        <div
          className="absolute inset-0 pointer-events-none z-[1]"
          style={{
            background: `
              linear-gradient(90deg, rgba(8,8,12,0.96) 0%, rgba(8,8,12,0.72) 34%, rgba(8,8,12,0.25) 68%, rgba(8,8,12,0.05) 100%),
              linear-gradient(to top, rgba(8,8,12,0.9) 0%, rgba(8,8,12,0.2) 55%, transparent 85%)
            `,
          }}
        />

        {/* ── Card content (row: poster · text · actions) ────── */}
        <div className="absolute inset-0 z-[2] flex items-center gap-4 sm:gap-7 px-4 sm:px-7 lg:px-11">
          {/* Poster */}
          {current && (
            <Link
              to={`/anime/${current.idMal}`}
              {...preloadHandlers('/anime/x')}
              className="shrink-0 hidden md:block self-center"
              aria-label={title}
            >
              <div className="relative">
                <div
                  className="absolute -inset-2 rounded-2xl blur-xl opacity-60"
                  style={{ background: `radial-gradient(closest-side, hsl(var(--theme-primary-h) var(--theme-primary-s) var(--theme-primary-l) / 0.5), transparent)` }}
                />
                <img
                  src={proxifyImgUrl(current.coverImage.extraLarge || current.coverImage.large || '')}
                  alt={title}
                  className="relative w-[120px] lg:w-[140px] aspect-[2/3] object-cover rounded-xl border border-white/10 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] transition-transform duration-500 group-hover:scale-[1.04]"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </Link>
          )}

          {/* Text column */}
          {current && (
            <div className="flex-1 min-w-0 flex flex-col justify-center py-4 sm:py-5">
              <h3 className="font-display font-bold text-white leading-tight tracking-tight line-clamp-2 text-[22px] sm:text-3xl lg:text-[34px]">
                <Link
                  to={`/anime/${current.idMal}`}
                  {...preloadHandlers('/anime/x')}
                  className="hover:text-primary transition-colors"
                >
                  {title}
                </Link>
              </h3>

              {/* Meta pills */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5 mb-2.5">
                {score != null && (
                  <span className={cn(metaPill, 'text-amber-300')}>
                    <Star className={cn(metaIcon, 'fill-amber-300 text-amber-300')} />
                    {score}%
                  </span>
                )}
                {current.seasonYear && (
                  <span className={metaPill}>
                    <Calendar className={metaIcon} />
                    {current.season ? `${current.season} ` : ''}{current.seasonYear}
                  </span>
                )}
                {current.episodes != null && (
                  <span className={metaPill}>
                    <Film className={metaIcon} />
                    {current.episodes}
                  </span>
                )}
                {current.format && (
                  <span className={metaPill}>
                    <Tv className={metaIcon} />
                    {current.format.replace('_', ' ')}
                  </span>
                )}
              </div>

              {current.description && (
                <p className="text-[12px] sm:text-[13px] text-white/65 max-w-2xl line-clamp-2 leading-relaxed hidden sm:block">
                  {stripHtml(current.description)}
                </p>
              )}

              {/* CTAs */}
              <div className="flex flex-wrap items-center gap-2.5 mt-3.5">
                <Link
                  to={`/watch/${current.idMal}?ep=1`}
                  {...preloadHandlers('/watch/x')}
                  className="group/btn inline-flex items-center gap-2 bg-white hover:bg-white/90 text-black h-9 px-5 rounded-full font-bold text-xs shadow-lg shadow-white/15"
                >
                  <Play className="h-3.5 w-3.5 fill-black transition-transform group-hover/btn:scale-110" />
                  Watch Now
                </Link>
                <Link
                  to={`/anime/${current.idMal}`}
                  {...preloadHandlers('/anime/x')}
                  className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white h-9 px-4 rounded-full font-semibold text-xs border border-white/15 backdrop-blur-md"
                >
                  More Info
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* ── Bottom-right: dots + counter/arrows ─────────────── */}
        {picks.length > 1 && (
          <div className="absolute bottom-3 right-4 sm:right-6 z-[3] flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              {picks.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Show pick: ${m.title.english || m.title.romaji}`}
                  className={cn(
                    'h-1 rounded-full transition-all duration-300',
                    i === index ? 'w-6 bg-primary shadow-[0_0_8px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.6)]' : 'w-2.5 bg-white/25 hover:bg-white/50',
                  )}
                />
              ))}
            </div>
            <span className="text-[11px] font-semibold text-white/70 tabular-nums tracking-wide pl-1">
              {String(index + 1).padStart(2, '0')}
              <span className="text-white/30"> / </span>
              {String(picks.length).padStart(2, '0')}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => goto(index - 1)}
                aria-label="Previous pick"
                className="h-7 w-7 rounded-full border border-white/15 bg-black/55 grid place-items-center text-white/75 hover:text-white hover:bg-white/15 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => goto(index + 1)}
                aria-label="Next pick"
                className="h-7 w-7 rounded-full border border-white/15 bg-black/55 grid place-items-center text-white/75 hover:text-white hover:bg-white/15 transition-colors"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </section>
  )
}
