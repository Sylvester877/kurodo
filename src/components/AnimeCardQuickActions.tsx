import { memo } from 'react'
import { Plus, Check } from 'lucide-react'
import { useWatchListStore } from '../store/useWatchListStore'
import { cn } from '../lib/utils'
import type { Anime } from '../types'

interface Props {
  anime: Anime
  visible: boolean
}

/**
 * Renders a "Quick Add" / "In List" button on card hover.
 * Isolated from the memo'd AnimeCard body so that mutations
 * in one card never trigger re-renders across the entire grid.
 */
export default memo(function AnimeCardQuickActions({ anime, visible }: Props) {
  const isInWatchlist = useWatchListStore((s) => s.isInWatchlist(anime.mal_id))
  const addToWatchlist = useWatchListStore((s) => s.addToWatchlist)
  const removeFromWatchlist = useWatchListStore((s) => s.removeFromWatchlist)

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isInWatchlist) {
      removeFromWatchlist(anime.mal_id)
    } else {
      addToWatchlist(anime)
    }
  }

  return (
    <div
      className={cn(
        'absolute bottom-3 left-1/2 -translate-x-1/2 z-[3] transition-all duration-300',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
      )}
    >
      <button
        onClick={handleToggle}
        className={cn(
          'glass-pill text-[11px] font-semibold transition-all duration-200 active:scale-95',
          isInWatchlist
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30 shadow-[0_0_16px_-4px_rgba(16,185,129,0.3)]'
            : 'bg-white/10 text-white/90 border-white/15 hover:bg-white/20 hover:border-white/25 shadow-lg',
        )}
      >
        {isInWatchlist ? (
          <>
            <Check className="h-3 w-3" />
            In list
          </>
        ) : (
          <>
            <Plus className="h-3 w-3" />
            My List
          </>
        )}
      </button>
    </div>
  )
})
