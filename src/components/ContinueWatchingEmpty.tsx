import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Play, Compass, Sparkles } from 'lucide-react'
import { getTrending } from '../api/anilist'
import { proxifyImgUrl } from '../lib/utils'
import { preloadHandlers } from '../lib/routePreloaders'

/**
 * Cinematic empty state for the Continue Watching rail — instead of a plain
 * grey box, new users get a film-strip panel whose backdrop is the current
 * #1 trending anime (shared with the hero query, so it's usually warm).
 * Purely presentational; quietly falls back to a gradient panel if the
 * backdrop isn't ready yet.
 */
export default function ContinueWatchingEmpty() {
  const { data } = useQuery({
    queryKey: ['feed', 'trending'],
    queryFn: () => getTrending(18),
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })
  const top = data?.[0] ?? null
  const backdrop =
    top?.bannerImage ||
    top?.coverImage?.extraLarge ||
    top?.coverImage?.large ||
    ''
  const title = top?.title?.english || top?.title?.romaji || null

  return (
    <Link
      to="/browse"
      {...preloadHandlers('/browse')}
      className="group relative block rounded-2xl overflow-hidden border border-white/[0.07] h-[190px] sm:h-[210px] bg-gradient-to-br from-[#181221] via-[#120e1a] to-[#0a0a12] shadow-[0_10px_40px_-16px_rgba(0,0,0,0.8)]"
    >
      {/* Backdrop artwork — the top trending show right now */}
      {backdrop && (
        <img
          src={proxifyImgUrl(backdrop)}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-50 transition-all duration-700 group-hover:opacity-65 group-hover:scale-[1.03]"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const img = e.currentTarget
            img.style.opacity = '0'
          }}
        />
      )}
      {/* Cinema scrims — deep left for text, soft right to blend into the page */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(90deg, rgba(6,5,10,0.96) 0%, rgba(6,5,10,0.72) 34%, rgba(6,5,10,0.12) 68%, rgba(6,5,10,0.55) 100%),
            linear-gradient(180deg, rgba(6,5,10,0.25) 0%, transparent 45%, rgba(6,5,10,0.5) 100%)`,
        }}
      />
      {/* Brand aura at the far right */}
      <div
        aria-hidden
        className="absolute -right-20 -top-24 h-72 w-72 rounded-full opacity-25 blur-3xl pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, hsl(var(--theme-primary-h) var(--theme-primary-s) var(--theme-primary-l) / 0.7), transparent 70%)',
        }}
      />

      {/* Content */}
      <div className="relative z-[2] h-full flex flex-col justify-center px-6 sm:px-9 max-w-xl">
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-primary/90 mb-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          Start watching
        </div>
        <h3 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight text-white leading-[1.1]">
          Your next favorite anime
          <br className="hidden sm:block" />
          <span className="text-gradient-brand"> is one click away</span>
        </h3>
        <p className="mt-2 text-[13px] text-white/55 leading-relaxed max-w-md">
          {title
            ? `Right now the community is watching ${title}. Hit play, and everything you watch will pick up here automatically.`
            : 'Hit play on anything and your progress will pick up here automatically.'}
        </p>

        {/* CTAs — decorative labels for the single strip action (the whole
            panel links to /browse, so both buttons land on the same target). */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-white text-black text-[13px] font-bold shadow-[0_6px_24px_-8px_rgba(255,255,255,0.4)] transition-all duration-200 group-hover:bg-white/90 group-hover:-translate-y-0.5">
            <Play className="h-3.5 w-3.5 fill-black transition-transform group-hover:scale-110" />
            Browse anime
          </span>
          <span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-white/[0.06] border border-white/[0.12] text-white/80 text-[12px] font-semibold backdrop-blur-sm">
            <Compass className="h-3.5 w-3.5" />
            Genres & filters
          </span>
        </div>

        <p className="mt-3 hidden sm:flex items-center gap-1.5 text-[10px] text-white/30 uppercase tracking-[0.14em]">
          <Sparkles className="h-3 w-3" />
          Watchlist syncs with your AniList
        </p>
      </div>
    </Link>
  )
}
