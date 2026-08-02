import { memo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Play, Star, Clock, Tv } from 'lucide-react'
import { getThisSeason, type FeedMedia } from '../api/anilist'
import SectionHeader from './SectionHeader'
import { proxifyImgUrl } from '../lib/utils'

function pickWide(m: FeedMedia): string {
  return m.bannerImage || ''
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim()
}

const OVERLAY_STYLE: React.CSSProperties = {
  background: `
    linear-gradient(90deg, rgba(8,8,10,0.92) 0%, rgba(8,8,10,0.55) 50%, rgba(8,8,10,0.05) 100%),
    linear-gradient(to top, rgba(8,8,10,0.95) 0%, rgba(8,8,10,0.45) 45%, transparent 75%)
  `,
}

export default memo(function FeaturedSlider() {
  const { data, isLoading } = useQuery({
    queryKey: ['featuredSlider'],
    queryFn: () => getThisSeason(20),
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })

  const items = (data ?? [])
    .filter((m) => m.idMal && m.bannerImage)
    .slice(0, 10)

  if (isLoading && items.length === 0) {
    return (
      <div className="mx-4 mt-8 mb-8">
        <div className="h-8 w-48 bg-card rounded shimmer mb-4" />
        <div className="h-52 bg-card rounded-xl shimmer" />
      </div>
    )
  }
  if (items.length === 0) return null

  return (
    <div className="mx-4 mt-8 mb-8">
      <SectionHeader
        title="Trending This Season"
        subtitle="The hottest shows airing right now"
        pill="TRENDING"
        pillTone="hot"
        to="/browse?filter=seasonal"
      />

      {/* Lightweight CSS scroll-snap carousel — no Swiper.js dependency */}
      <div
        className="flex gap-4 overflow-x-auto custom-scrollbar pb-4 -mx-1 px-1 snap-x snap-mandatory contain-auto"
      >
        {items.map((m) => {
          const title = m.title.english || m.title.romaji
          const score = m.averageScore ? (m.averageScore / 10).toFixed(1) : null
          const description = m.description ? stripHtml(m.description) : ''
          return (
            <Link
              key={m.id}
              to={`/anime/${m.idMal}`}
              className="group block card-tilt rounded-2xl shrink-0 snap-start"
              style={{ width: 'min(420px, 82vw)' }}
            >
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <img
                    src={proxifyImgUrl(pickWide(m))}
                    alt={title}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                  />

                  <div className="absolute inset-0 pointer-events-none" style={OVERLAY_STYLE} />

                  {/* Top-left badges */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-[2]">
                    {m.status === 'RELEASING' && (
                      <div className="glass-pill py-0.5 px-1.5 bg-emerald-500/90 border-emerald-400/40 text-[9px] font-bold uppercase tracking-wider text-white shadow-lg">
                        <span className="h-1 w-1 rounded-full bg-white animate-pulse" />
                        Airing
                      </div>
                    )}
                    {m.format && (
                      <div className="glass-pill py-0.5 px-1.5 text-[9px] font-bold uppercase tracking-wider text-white/80 shadow-lg">
                        {m.format}
                      </div>
                    )}
                    {m.episodes && (
                      <div className="glass-pill py-0.5 px-1.5 text-[9px] font-semibold text-white/70 shadow-lg">
                        <Tv className="h-2.5 w-2.5" />
                        {m.episodes}
                      </div>
                    )}
                  </div>

                  {/* Bottom content */}
                  <div className="absolute bottom-0 left-0 right-0 p-3 z-[2]">
                    <h3 className="font-bold text-[13px] text-white line-clamp-1 mb-1">
                      {title}
                    </h3>
                    {description && (
                      <p className="text-[10px] text-white/60 line-clamp-2 mb-2 leading-snug hidden sm:block">
                        {description}
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      {score && (
                        <span className="glass-pill py-0.5 px-1.5 text-yellow-400 border-yellow-500/25 bg-yellow-500/15 text-[10px] font-semibold">
                          <Star className="h-3 w-3 fill-yellow-400" />
                          {score}
                        </span>
                      )}
                      {m.season && m.seasonYear && (
                        <span className="glass-pill py-0.5 px-1.5 text-[10px] text-white/70 capitalize">
                          <Clock className="h-2.5 w-2.5" />
                          {m.season} {m.seasonYear}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Play button */}
                  <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-all duration-200 z-[3]">
                    <div className="h-12 w-12 rounded-full bg-primary/95 grid place-items-center shadow-[0_0_30px_hsl(245,75%,60%,0.6)] group-hover:scale-105 transition-transform">
                      <Play className="h-5 w-5 text-white fill-white ml-0.5" />
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
})