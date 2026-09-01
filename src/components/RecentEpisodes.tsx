import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Play, Clock, Shuffle } from 'lucide-react'
import { getRecentEpisodes, type RecentEpisode } from '../api/anilist'
import { getBackendOrigin, cn } from '../lib/utils'
import StaggerCard from './StaggerCard'
import SectionHeader from './SectionHeader'

function timeAgo(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

type FilterTab = 'all' | 'sub' | 'dub' | 'trending' | 'random'

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sub', label: 'Sub' },
  { value: 'dub', label: 'Dub' },
  { value: 'trending', label: 'Trending' },
  { value: 'random', label: 'Random' },
]

export default function RecentEpisodes() {
  const [filter, setFilter] = useState<FilterTab>('all')

  const { data, isLoading } = useQuery({
    queryKey: ['recentEpisodes', filter],
    queryFn: async () => {
      // Use the new discover endpoint when filter is active (non-default)
      if (filter !== 'all') {
        const origin = getBackendOrigin()
        const res = await fetch(`${origin}/api/discover/recent?filter=${filter}&limit=18`)
        if (!res.ok) throw new Error('Failed to fetch recent episodes')
        const json = await res.json()
        if (!json.ok) throw new Error(json.error || 'Failed')
        // Map to same shape as getRecentEpisodes return, preserving availability fields
        return json.data.episodes.map((e: any) => ({
          media: e.media,
          episode: e.episode,
          airedAt: e.airingAt,
          hasDub: e.hasDub,
          hasSub: e.hasSub,
          likelyDub: e.likelyDub,
          likelySub: e.likelySub,
        }))
      }
      return getRecentEpisodes(18)
    },
    staleTime: 2 * 60 * 1000,
    meta: { persist: true },
  })

  // Client-side random shuffle (stable within session via useMemo)
  const shuffled = useMemo(() => {
    if (filter !== 'random' || !data) return null
    const items = [...data]
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[items[i], items[j]] = [items[j], items[i]]
    }
    return items
  }, [data, filter])

  const rawItems = filter === 'random' && shuffled ? shuffled : (data ?? [])
  const items = rawItems.slice(0, 14)

  return (
    <section className="mt-8 mx-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-1">
        <SectionHeader
          title="Recent Episodes"
          pill="LIVE"
          pillTone="hot"
          subtitle="Latest drops from currently airing shows"
          to="/browse"
          linkLabel="View All"
        />

        {/* Filter tabs — Anikoto-style grouped pill group */}
        <div
          role="radiogroup"
          aria-label="Episode filter"
          className="inline-flex items-center gap-0.5 rounded-2xl bg-white/[0.04] border border-white/[0.06] p-1 self-start"
        >
          {FILTER_TABS.map((tab) => {
            const active = filter === tab.value
            return (
              <button
                key={tab.value}
                role="radio"
                aria-checked={active}
                onClick={() => setFilter(tab.value)}
                className={cn(
                  'relative px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.1em] transition-all duration-200',
                  active
                    ? 'bg-primary text-white shadow-[0_2px_10px_-2px_hsl(245,75%,60%,0.5)]'
                    : 'text-white/45 hover:text-white/80 hover:bg-white/[0.05]',
                )}
              >
                {tab.value === 'random' ? (
                  <span className="inline-flex items-center gap-1">
                    <Shuffle className="h-3 w-3" />
                    {tab.label}
                  </span>
                ) : (
                  tab.label
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Mobile (< sm): touch-friendly horizontal scroller.
          sm+: dense responsive grid matching the main feed columns. */}
      <div
        className="flex sm:hidden gap-3 overflow-x-auto custom-scrollbar pb-3 -mx-1 px-1 contain-auto"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="shrink-0 w-[210px] aspect-[16/10] rounded-xl bg-card shimmer"
                style={{ scrollSnapAlign: 'start' }}
              />
            ))
          : items.map((item: RecentEpisode) => (
              <div
                key={item.media.id}
                className="shrink-0 w-[210px]"
                style={{ scrollSnapAlign: 'start' }}
              >
                <EpisodeCard item={item} />
              </div>
            ))}
        <div className="shrink-0 w-2" aria-hidden />
      </div>

      <div className="hidden sm:grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5 contain-auto">
        {isLoading
          ? Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="aspect-[16/10] rounded-xl bg-card shimmer" />
            ))
          : items.map((item: RecentEpisode, i: number) => (
              <StaggerCard key={item.media.id} index={i}>
                <EpisodeCard item={item} />
              </StaggerCard>
            ))}
      </div>
    </section>
  )
}

function EpisodeCard({ item }: { item: Awaited<ReturnType<typeof getRecentEpisodes>>[number] }) {
  const cover =
    item.media.bannerImage ||
    item.media.coverImage.extraLarge ||
    item.media.coverImage.large ||
    ''
  const title = item.media.title.english || item.media.title.romaji
  const href = item.media.idMal
    ? `/watch/${item.media.idMal}?ep=${item.episode}`
    : '#'
  const color = item.media.coverImage.color || 'hsl(245 75% 60%)'

  return (
    <Link
      to={href}
      className="group block relative rounded-2xl overflow-hidden border border-white/[0.06] bg-black/50 hover:border-white/[0.15] hover:bg-black/65 transition-all duration-200"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-black">
        {cover ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-400"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-primary/15 via-zinc-900 to-zinc-950">
            <span className="text-white/20 font-black text-3xl select-none">
              {(title || '?').charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent"
          aria-hidden
        />

        {/* EP badge */}
        <div
          className="absolute top-2 left-2 glass-pill py-0.5 px-1.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-lg"
          style={{ backgroundColor: `${color}cc`, borderColor: `${color}80` }}
        >
          EP {item.episode}
        </div>

        {/* Format pill */}
        {item.media.format && (
          <div className="absolute top-2 right-2 glass-pill py-0.5 px-1.5 bg-black/70 border-white/10 text-[9px] font-bold uppercase tracking-wider text-white/90 shadow-lg">
            {item.media.format}
          </div>
        )}

        {/* Play affordance */}
        <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="h-11 w-11 rounded-full bg-primary/95 grid place-items-center shadow-[0_0_30px_hsl(245,75%,60%,0.6)]">
            <Play className="h-4 w-4 text-white fill-white ml-0.5" />
          </div>
        </div>

        {/* Title + meta */}
        <div className="absolute bottom-0 left-0 right-0 p-2.5">
          <p className="text-[11px] font-semibold text-white line-clamp-1 mb-0.5">
            {title}
          </p>
          <div className="flex items-center gap-1.5 text-[10px] text-white/60">
            <Clock className="h-2.5 w-2.5" />
            <span>{timeAgo(item.airedAt)}</span>
            {item.media.episodes && (
              <>
                <span>·</span>
                <span>{item.media.episodes} eps</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
