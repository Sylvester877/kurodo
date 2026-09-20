import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getNewReleases, getNewlyAdded, getJustCompleted,
  type FeedMedia,
} from '../api/anilist'
import { cn } from '../lib/utils'
import { feedToAnimeList } from '../lib/adapters'
import AnimeCard from './AnimeCard'
import StaggerCard from './StaggerCard'

// ── anikototv.tv pattern (researched Sep 2026): the "New Release / Newly
// Added / Just Completed" tabbed strip under Latest Episode. Each tab is its
// own AniList query (30-min cache; tabs swap from cache after first view —
// 0 network on revisit).
type Tab = 'new-release' | 'new-added' | 'just-completed'

const TABS: { key: Tab; label: string }[] = [
  { key: 'new-release', label: 'New Release' },
  { key: 'new-added', label: 'Newly Added' },
  { key: 'just-completed', label: 'Just Completed' },
]

const FETCHERS: Record<Tab, () => Promise<FeedMedia[]>> = {
  'new-release': () => getNewReleases(14),
  'new-added': () => getNewlyAdded(14),
  'just-completed': () => getJustCompleted(14),
}

export default function ReleaseStatusTabs() {
  const [tab, setTab] = useState<Tab>('new-release')

  const { data, isLoading } = useQuery({
    queryKey: ['feed', 'release-status', tab],
    queryFn: FETCHERS[tab],
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })

  const items = (data ?? []).slice(0, 7)

  return (
    <section className="mt-7 mx-3 sm:mx-4">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Fresh off the press
          </h2>
          <p className="text-xs text-white/40 mt-0.5">What just started, landed, or wrapped up</p>
        </div>

        {/* ── Tab pill row — anikototv style ── */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all',
                tab === t.key
                  ? 'bg-primary text-white shadow-[0_0_14px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.35)]'
                  : 'text-white/55 hover:text-white hover:bg-white/[0.06]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {isLoading && items.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-x-3 gap-y-5">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-xl shimmer" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-x-3 gap-y-5">
              {feedToAnimeList(items).map((anime, i) => (
                <StaggerCard key={anime.mal_id} index={i}>
                  <AnimeCard anime={anime} quickActions={false} magnetic={false} />
                </StaggerCard>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  )
}
