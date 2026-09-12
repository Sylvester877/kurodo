import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, BookOpen, ChevronLeft, ChevronRight } from 'lucide-react'
import { proxifyImgUrl } from '../lib/utils'

export type MangaHeroItem = {
  id: number | string
  title: string
  coverUrl: string
  bannerUrl?: string | null
  description?: string | null
  genres?: string[]
  score?: number | null
  year?: number | null
  chapters?: number | null
  format?: string | null
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export default function MangaHero({ items }: { items: MangaHeroItem[] }) {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)

  const next = useCallback(() => setIdx((i) => (i + 1) % items.length), [items.length])
  const prev = useCallback(() => setIdx((i) => (i - 1 + items.length) % items.length), [items.length])

  useEffect(() => {
    if (paused || items.length <= 1) return
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return
    const t = window.setInterval(next, 6000)
    return () => window.clearInterval(t)
  }, [paused, next, items.length])

  if (items.length === 0) return null
  const cur = items[idx]

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative mb-6 overflow-hidden rounded-2xl border border-white/[0.07] bg-[#1a1a1a]"
      style={{ height: 420 }}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={String(cur.id)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0"
        >
          {/* Banner */}
          {cur.bannerUrl ? (
            <img
              src={proxifyImgUrl(cur.bannerUrl)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="eager"
              fetchPriority="high"
            />
          ) : cur.coverUrl ? (
            <img
              src={proxifyImgUrl(cur.coverUrl)}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-60"
              loading="eager"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#2a2a2a] to-[#1a1a1a]" />
          )}
          {/* Scrims — Onisaga: left + bottom heavy so white text pops on warm charcoal */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-[#262626]/10" />

          {/* Content */}
          <div className="absolute inset-0 flex items-end p-6 sm:p-8">
            <div className="flex gap-5 sm:gap-6 max-w-[72%] sm:max-w-[60%]">
              {/* Cover thumb — Onisaga hero poster */}
              <div className="hidden sm:block shrink-0">
                <div className="h-[212px] w-[150px] overflow-hidden rounded-xl border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.6)] bg-white/[0.04]">
                  {cur.coverUrl ? (
                    <img src={proxifyImgUrl(cur.coverUrl)} alt={cur.title} className="h-full w-full object-cover" loading="eager" />
                  ) : (
                    <div className="grid h-full place-items-center">
                      <BookOpen className="h-8 w-8 text-white/15" />
                    </div>
                  )}
                </div>
              </div>
              <div className="min-w-0 pb-1">
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {cur.format && (
                    <span className="rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/80">
                      {cur.format}
                    </span>
                  )}
                  {cur.year && (
                    <span className="rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/70">
                      {cur.year}
                    </span>
                  )}
                  {cur.score != null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 border border-yellow-500/20 px-2 py-0.5 text-[10px] font-bold text-yellow-300">
                      <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" /> {cur.score.toFixed(1)}
                    </span>
                  )}
                  {cur.chapters != null && (
                    <span className="rounded-full bg-white/10 border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/60">
                      {cur.chapters} ch
                    </span>
                  )}
                </div>
                <h2 className="font-display text-[22px] sm:text-[28px] font-extrabold leading-none tracking-tight text-white line-clamp-2 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
                  {cur.title}
                </h2>
                {cur.genres && cur.genres.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {cur.genres.slice(0, 4).map((g) => (
                      <span key={g} className="text-[10px] font-medium text-white/55">
                        #{g}
                      </span>
                    ))}
                  </div>
                )}
                {cur.description && (
                  <p className="mt-2 hidden sm:line-clamp-3 text-[12px] leading-relaxed text-white/65 max-w-[52ch]">
                    {stripHtml(cur.description).slice(0, 260)}
                  </p>
                )}
                <Link
                  to={`/manga/${cur.id}`}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-xs font-extrabold tracking-wide text-black hover:bg-white/90 transition-colors shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Read Now
                </Link>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Counter + dots */}
      <div className="absolute bottom-4 right-4 sm:right-6 flex items-center gap-3">
        <span className="text-[10px] font-bold tracking-widest text-white/50 tabular-nums">
          {String(idx + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
        </span>
        <div className="flex items-center gap-1.5">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-white' : 'w-1.5 bg-white/30 hover:bg-white/50'}`}
            />
          ))}
        </div>
      </div>

      {/* Arrows — show on hover like Onisaga */}
      {items.length > 1 && (
        <>
          <button
            onClick={prev}
            aria-label="Previous"
            className="absolute left-3 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-full bg-black/40 border border-white/10 text-white/70 hover:text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 sm:opacity-100 transition-all backdrop-blur"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={next}
            aria-label="Next"
            className="absolute right-3 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-full bg-black/40 border border-white/10 text-white/70 hover:text-white hover:bg-black/60 opacity-0 group-hover:opacity-100 sm:opacity-100 transition-all backdrop-blur"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  )
}
