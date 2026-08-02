import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp } from 'lucide-react'
import { getTrending } from '../api/anilist'
import { preloadHandlers } from '../lib/routePreloaders'

/**
 * Anidap-signature "Top searches" strip.
 *
 * A dense, text-first row of trending titles that sits directly under the
 * hero. Each title links straight to its anime page, doubling as both a
 * trending indicator and a quick-navigation shortcut so users can jump to a
 * popular show without opening search.
 *
 * Reuses the same `getTrending` data the hero already warms, so this adds no
 * extra network cost on a typical homepage load.
 */
export default function TopSearchesBar() {
  const { data } = useQuery({
    queryKey: ['hero-featured'], // shared cache key with <Hero/> — no extra fetch
    queryFn: () => getTrending(12),
    staleTime: 30 * 60 * 1000,
    meta: { persist: true },
  })

  const titles = (data ?? [])
    .filter((m) => m.idMal)
    .slice(0, 10)
    .map((m) => ({
      id: m.idMal as number,
      title: m.title.english || m.title.romaji,
    }))

  if (titles.length === 0) return null

  return (
    <div className="mx-4 mt-5">
      <div className="flex items-center gap-3 overflow-x-auto custom-scrollbar py-2 pl-3 pr-2 rounded-xl bg-white/[0.03] border border-white/[0.05]">
        <span className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          Top searches
        </span>
        <div className="flex items-center gap-1 whitespace-nowrap">
          {titles.map((t, i) => (
            <span key={t.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-white/15 text-[11px]">·</span>}
              <Link
                to={`/anime/${t.id}`}
                {...preloadHandlers('/anime/x')}
                className="text-[12px] font-medium text-white/70 hover:text-white transition-colors px-1.5 py-0.5 rounded-md hover:bg-white/[0.06]"
              >
                {t.title}
              </Link>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
