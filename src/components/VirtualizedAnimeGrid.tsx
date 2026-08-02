import { useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import AnimeCard from './AnimeCard'
import StaggerCard from './StaggerCard'
import type { Anime } from '../types'

interface Props {
  animes: Anime[]
  /** Called when the user scrolls near the end — for infinite scroll. */
  onEndReached?: () => void
  /** Whether more data is currently loading. */
  isLoadingMore?: boolean
  /** Whether there are more pages to load. */
  hasNextPage?: boolean
  /** Optional class name for the outer container. */
  className?: string
  /** Show magnetic tilt on cards. */
  magnetic?: boolean
  /** Show quick actions on cards. */
  quickActions?: boolean
}

/**
 * Determines the number of grid columns based on container width.
 * Matches the Tailwind responsive breakpoints used by Browse/Search.
 */
function getColumns(width: number): number {
  if (width >= 1536) return 7  // 2xl
  if (width >= 1280) return 6  // xl
  if (width >= 1024) return 5  // lg
  if (width >= 768)  return 4  // md
  if (width >= 640)  return 3  // sm
  return 2                       // default
}

/** Gap between grid cells in px — matches gap-y-5 (20px) */
const GRID_GAP = 20

/**
 * Virtualized anime grid — renders only the rows visible in the viewport.
 * Uses @tanstack/react-virtual's useWindowVirtualizer for document-level scrolling.
 *
 * Cards have aspect-[3/4] poster frames, so row height = cellWidth * (4/3).
 * Column count is responsive (2–7) based on container width via ResizeObserver.
 *
 * For infinite scroll, call onEndReached when the last visible row is near the end.
 */
export default function VirtualizedAnimeGrid({
  animes,
  onEndReached,
  isLoadingMore,
  hasNextPage,
  className = '',
  magnetic = false,
  quickActions = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const endReachedFired = useRef(false)

  // ── Responsive column count from container width ──
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    observer.observe(el)
    // Set initial width
    setContainerWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  const columns = getColumns(containerWidth)

  // ── Chunk flat list into rows ──
  const rows = useMemo(() => {
    const chunked: Anime[][] = []
    for (let i = 0; i < animes.length; i += columns) {
      chunked.push(animes.slice(i, i + columns))
    }
    return chunked
  }, [animes, columns])

  // ── Calculate row height from container width + aspect ratio ──
  const cellWidth = columns > 0 ? (containerWidth - (columns - 1) * GRID_GAP) / columns : 200
  const rowHeight = cellWidth * (4 / 3) + GRID_GAP // poster aspect 3/4 + gap

  // ── Window virtualizer ──
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 5,
    scrollMargin: 0,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // ── Infinite scroll: fire onEndReached when near the bottom ──
  useLayoutEffect(() => {
    if (!onEndReached || !hasNextPage || isLoadingMore) {
      endReachedFired.current = false
      return
    }
    const lastVisible = virtualItems[virtualItems.length - 1]
    if (!lastVisible) return
    // Fire when within 3 rows of the end
    if (lastVisible.index >= rows.length - 3 && !endReachedFired.current) {
      endReachedFired.current = true
      onEndReached()
    }
    if (lastVisible.index < rows.length - 3) {
      endReachedFired.current = false
    }
  }, [virtualItems, rows.length, onEndReached, hasNextPage, isLoadingMore])

  // ── Empty state ──
  if (animes.length === 0) return null

  return (
    <div ref={containerRef} className={className}>
      {/* Spacer for total scroll height — virtualizer manages its own scroll. */}
      <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {virtualItems.map((vRow) => {
          const rowAnimes = rows[vRow.index]
          if (!rowAnimes?.length) return null

          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              <div
                className="grid gap-x-3 gap-y-5 contain-auto"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {rowAnimes.map((anime, i) => (
                  <StaggerCard key={anime.mal_id} index={i % columns}>
                    <AnimeCard anime={anime} magnetic={magnetic} quickActions={quickActions} />
                  </StaggerCard>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Loading more indicator */}
      {isLoadingMore && (
        <div className="flex justify-center py-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Loading more
            </span>
          </div>
        </div>
      )}

      {/* End of results */}
      {!hasNextPage && animes.length > 0 && (
        <div className="flex justify-center py-6">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-px w-10 bg-white/[0.06]" />
            <span className="text-[10px] uppercase tracking-wider font-semibold">
              {animes.length.toLocaleString()} titles loaded
            </span>
            <div className="h-px w-10 bg-white/[0.06]" />
          </div>
        </div>
      )}
    </div>
  )
}
