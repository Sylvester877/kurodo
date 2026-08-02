import { useSettings, type SubDubFilter } from '../store/useSettings'
import SegmentedControl from './SegmentedControl'

const OPTIONS: { value: SubDubFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sub', label: 'Sub' },
  { value: 'dub', label: 'Dub' },
]

/**
 * Compact Sub / Dub / All audio-availability filter pill group.
 *
 * The selection is persisted in `useSettings.subDubFilter` and consumed by the
 * homepage / browse grids via `filterBySubDub`. Picking "Sub" or "Dub" also
 * nudges the player's default `audio` preference so the choice carries through
 * to playback.
 */
export default function SubDubToggle({ className }: { className?: string }) {
  const value = useSettings((s) => s.subDubFilter)
  const set = useSettings((s) => s.set)

  return (
    <SegmentedControl<SubDubFilter>
      value={value}
      options={OPTIONS}
      onChange={(v) => {
        set('subDubFilter', v)
        if (v === 'sub') set('audio', 'sub')
        if (v === 'dub') set('audio', 'dub')
      }}
      label="Audio language filter"
      size="sm"
      className={className}
    />
  )
}

/**
 * Client-side heuristic filter for the Sub/Dub toggle.
 *
 * Real per-title dub availability lives in the scraper/provider layer, which
 * isn't surfaced on AniList feed data. As an MVP we approximate:
 *   • "all" — no filtering.
 *   • "dub" — keep titles that carry an English title (a decent proxy for a
 *     show being licensed/dubbed in English).
 *   • "sub" — keep everything (sub is the universal baseline).
 * This never empties a section on the default "all" setting.
 */
export function filterBySubDub<T extends { title_english?: string | null }>(
  items: T[],
  filter: SubDubFilter,
): T[] {
  if (filter === 'dub') {
    const dubbed = items.filter((a) => !!a.title_english)
    return dubbed.length > 0 ? dubbed : items
  }
  return items
}
