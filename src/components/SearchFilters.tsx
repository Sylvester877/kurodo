import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Check, X, ArrowDownUp } from 'lucide-react'
import { getAnimeGenres } from '../api/anime'
import { cn } from '../lib/utils'
import type { SearchFilters } from '../api/anime'
import type { Genre } from '../types'

interface Props {
  value: SearchFilters
  onChange: (next: SearchFilters) => void
}

const FORMATS = [
  { value: 'tv',      label: 'TV' },
  { value: 'movie',   label: 'Movie' },
  { value: 'ova',     label: 'OVA' },
  { value: 'special', label: 'Special' },
  { value: 'ona',     label: 'ONA' },
  { value: 'music',   label: 'Music' },
]

const STATUSES = [
  { value: 'airing',   label: 'Airing' },
  { value: 'complete', label: 'Completed' },
  { value: 'upcoming', label: 'Upcoming' },
]

const SORTS = [
  { value: 'score',      label: 'Score' },
  { value: 'popularity', label: 'Popularity' },
  { value: 'start_date', label: 'Newest' },
  { value: 'title',      label: 'Title (A→Z)' },
  { value: 'rank',       label: 'Rank' },
] as const

const SCORE_OPTIONS = [
  { value: null, label: 'Any score' },
  { value: 9,    label: '9+ (top)' },
  { value: 8,    label: '8+ (great)' },
  { value: 7,    label: '7+ (good)' },
  { value: 6,    label: '6+ (decent)' },
]

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = (() => {
  const out: number[] = []
  for (let y = CURRENT_YEAR + 1; y >= 1960; y--) out.push(y)
  return out
})()

/** A pill that opens a small dropdown panel. */
function FilterPill({
  active, label, onClear, children,
}: {
  active: boolean
  label: string
  onClear?: () => void
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border',
          active
            ? 'bg-primary text-white border-primary shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.5)]'
            : 'bg-white/[0.04] text-white/75 border-white/8 hover:bg-white/[0.08] hover:text-white',
        )}
      >
        <span>{label}</span>
        {active && onClear ? (
          <button
            onClick={(e) => { e.stopPropagation(); onClear() }}
            aria-label={`Clear ${label}`}
            className="rounded hover:bg-white/15 -mr-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        ) : (
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        )}
      </button>
      {open && (
        <div className="absolute top-full mt-2 left-0 z-50 min-w-[200px] max-h-[360px] overflow-y-auto custom-scrollbar glass-card rounded-xl p-1.5 shadow-2xl">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  active, children, onClick,
}: {
  active?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors text-left',
        active
          ? 'bg-primary/15 text-primary font-semibold'
          : 'text-white/75 hover:bg-white/5 hover:text-white',
      )}
    >
      <span className="truncate">{children}</span>
      {active && <Check className="h-3 w-3 shrink-0" />}
    </button>
  )
}

export default function SearchFilters({ value, onChange }: Props) {
  const set = <K extends keyof SearchFilters>(key: K, v: SearchFilters[K]) =>
    onChange({ ...value, [key]: v })

  const genresQuery = useQuery({
    queryKey: ['genres'],
    queryFn: getAnimeGenres,
    staleTime: 24 * 60 * 60 * 1000,
    meta: { persist: true },
  })
  const allGenres: Genre[] = genresQuery.data?.data ?? []
  const activeGenres = value.genres ?? []
  const activeGenreNames = activeGenres
    .map((id) => allGenres.find((g) => g.mal_id === id)?.name)
    .filter(Boolean) as string[]

  const formatLabel = value.format
    ? FORMATS.find((f) => f.value === value.format)?.label ?? 'Format'
    : 'Format'
  const statusLabel = value.status
    ? STATUSES.find((s) => s.value === value.status)?.label ?? 'Status'
    : 'Status'
  const sortLabel =
    SORTS.find((o) => o.value === (value.orderBy ?? 'score'))?.label ?? 'Score'
  const scoreLabel = value.minScore
    ? `${value.minScore}+`
    : 'Any score'
  const yearLabel =
    value.yearFrom && value.yearTo
      ? value.yearFrom === value.yearTo
        ? String(value.yearFrom)
        : `${value.yearFrom}–${value.yearTo}`
      : value.yearFrom
        ? `${value.yearFrom}+`
        : value.yearTo
          ? `≤${value.yearTo}`
          : 'Year'
  const genreLabel =
    activeGenreNames.length === 0
      ? 'Genre'
      : activeGenreNames.length === 1
        ? activeGenreNames[0]
        : `${activeGenreNames.length} genres`

  const activeCount =
    (value.format ? 1 : 0) +
    (value.status ? 1 : 0) +
    (activeGenres.length ? 1 : 0) +
    (value.minScore ? 1 : 0) +
    (value.yearFrom || value.yearTo ? 1 : 0)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <FilterPill
        active={!!value.format}
        label={formatLabel}
        onClear={() => set('format', null)}
      >
        {(close) => (
          <>
            <MenuItem
              active={!value.format}
              onClick={() => { set('format', null); close() }}
            >
              Any format
            </MenuItem>
            <div className="border-t border-white/5 my-1" />
            {FORMATS.map((f) => (
              <MenuItem
                key={f.value}
                active={value.format === f.value}
                onClick={() => { set('format', f.value); close() }}
              >
                {f.label}
              </MenuItem>
            ))}
          </>
        )}
      </FilterPill>

      <FilterPill
        active={!!value.status}
        label={statusLabel}
        onClear={() => set('status', null)}
      >
        {(close) => (
          <>
            <MenuItem
              active={!value.status}
              onClick={() => { set('status', null); close() }}
            >
              Any status
            </MenuItem>
            <div className="border-t border-white/5 my-1" />
            {STATUSES.map((st) => (
              <MenuItem
                key={st.value}
                active={value.status === st.value}
                onClick={() => { set('status', st.value); close() }}
              >
                {st.label}
              </MenuItem>
            ))}
          </>
        )}
      </FilterPill>

      <FilterPill
        active={activeGenres.length > 0}
        label={genreLabel}
        onClear={() => set('genres', null)}
      >
        {() => (
          <>
            <MenuItem
              active={activeGenres.length === 0}
              onClick={() => set('genres', null)}
            >
              All genres
            </MenuItem>
            <div className="border-t border-white/5 my-1" />
            {allGenres.map((g) => {
              const checked = activeGenres.includes(g.mal_id)
              return (
                <MenuItem
                  key={g.mal_id}
                  active={checked}
                  onClick={() => {
                    if (checked) {
                      const next = activeGenres.filter((id) => id !== g.mal_id)
                      set('genres', next.length ? next : null)
                    } else {
                      set('genres', [...activeGenres, g.mal_id])
                    }
                  }}
                >
                  <span className="flex items-center justify-between gap-2 w-full">
                    <span>{g.name}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {g.count.toLocaleString()}
                    </span>
                  </span>
                </MenuItem>
              )
            })}
          </>
        )}
      </FilterPill>

      <FilterPill
        active={!!value.minScore}
        label={scoreLabel}
        onClear={() => set('minScore', null)}
      >
        {(close) => (
          <>
            {SCORE_OPTIONS.map((o) => (
              <MenuItem
                key={String(o.value)}
                active={value.minScore === o.value}
                onClick={() => { set('minScore', o.value); close() }}
              >
                {o.label}
              </MenuItem>
            ))}
          </>
        )}
      </FilterPill>

      <FilterPill
        active={!!(value.yearFrom || value.yearTo)}
        label={yearLabel}
        onClear={() => { onChange({ ...value, yearFrom: null, yearTo: null }) }}
      >
        {() => (
          <div className="p-2 space-y-2 min-w-[200px]">
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-1">
              From
            </p>
            <select
              value={value.yearFrom ?? ''}
              onChange={(e) =>
                set('yearFrom', e.target.value ? Number(e.target.value) : null)
              }
              className="w-full text-xs rounded-lg bg-white/[0.04] text-white border border-white/10 px-2 py-1.5 focus:border-primary/50 focus:outline-none"
            >
              <option value="">Any year</option>
              {YEARS.map((y) => (
                <option key={y} value={y} className="bg-card">{y}</option>
              ))}
            </select>
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground px-1 pt-1">
              To
            </p>
            <select
              value={value.yearTo ?? ''}
              onChange={(e) =>
                set('yearTo', e.target.value ? Number(e.target.value) : null)
              }
              className="w-full text-xs rounded-lg bg-white/[0.04] text-white border border-white/10 px-2 py-1.5 focus:border-primary/50 focus:outline-none"
            >
              <option value="">Any year</option>
              {YEARS.map((y) => (
                <option key={y} value={y} className="bg-card">{y}</option>
              ))}
            </select>
          </div>
        )}
      </FilterPill>

      <FilterPill
        active={(value.orderBy ?? 'score') !== 'score' || value.sort === 'asc'}
        label={`${sortLabel}${value.sort === 'asc' ? ' ↑' : ' ↓'}`}
      >
        {(close) => (
          <>
            {SORTS.map((o) => (
              <MenuItem
                key={o.value}
                active={(value.orderBy ?? 'score') === o.value}
                onClick={() => {
                  onChange({ ...value, orderBy: o.value, sort: value.sort ?? 'desc' })
                  close()
                }}
              >
                <span className="flex items-center gap-2">
                  <ArrowDownUp className="h-3 w-3" />
                  {o.label}
                </span>
              </MenuItem>
            ))}
            <div className="border-t border-white/5 my-1" />
            <MenuItem
              active={(value.sort ?? 'desc') === 'desc'}
              onClick={() => { onChange({ ...value, sort: 'desc' }); close() }}
            >
              Descending ↓
            </MenuItem>
            <MenuItem
              active={value.sort === 'asc'}
              onClick={() => { onChange({ ...value, sort: 'asc' }); close() }}
            >
              Ascending ↑
            </MenuItem>
          </>
        )}
      </FilterPill>

      {activeCount > 0 && (
        <button
          onClick={() =>
            onChange({
              format: null, status: null, genres: null,
              minScore: null, yearFrom: null, yearTo: null,
              orderBy: null, sort: null, sfw: value.sfw,
            })
          }
          className="ml-1 flex items-center gap-1 px-2 py-1 rounded text-[10px] uppercase tracking-wider font-bold text-muted-foreground hover:text-red-400 transition-colors"
        >
          <X className="h-3 w-3" />
          Clear {activeCount}
        </button>
      )}
    </div>
  )
}
