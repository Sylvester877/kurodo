import { memo, type Ref } from 'react'
import { CheckCircle2, Play, Star, Captions } from 'lucide-react'
import { cn } from '../lib/utils'
import { buildEpisodeImageUrl } from '../lib/episodeImage'
import type { AniZipEpisode } from '../api/anizip'

interface Props {
  ep: AniZipEpisode
  /** Show cover image used as thumbnail fallback. */
  animeImage: string | null
  accent: string | null
  isCurrent: boolean
  watched: boolean
  fillerMark: string | null
  /** 0..100 watch progress for the bottom bar. */
  progressPct: number
  streamTypeLabel: string
  onSelect: () => void
  btnRef?: Ref<HTMLButtonElement>
}

/**
 * Anikage-style episode row: thumbnail left with EP badge, title + synopsis
 * right, meta row (CC pill, score, air date) under the synopsis. No hover
 * scaling — selection feedback is background/border only.
 */
const EpisodeRow = memo(function EpisodeRow({
  ep, animeImage, accent, isCurrent, watched, fillerMark, progressPct, streamTypeLabel, onSelect, btnRef,
}: Props) {
  const epTitle = ep.title?.en || ep.title?.['x-jat'] || null
  const date = ep.airDate || ep.airDateUtc
  const airDate = date ? (() => {
    try { return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch { return null }
  })() : null
  const score = ep.rating ? parseFloat(ep.rating) : null
  const isMostlyDone = progressPct >= 90

  return (
    <button
      ref={btnRef}
      onClick={onSelect}
      className={cn(
        'group w-full flex items-stretch gap-3 rounded-2xl border text-left relative overflow-hidden transition-colors duration-200',
        isCurrent
          ? 'bg-primary/[0.12] border-primary/40 shadow-[0_0_24px_-8px_hsl(245,75%,60%,0.45)]'
          : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12]',
      )}
    >
      {isCurrent && (
        <div
          className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full"
          style={{ background: accent ? `linear-gradient(180deg, ${accent}, ${accent}88)` : 'linear-gradient(180deg, hsl(245,75%,60%), hsl(245,75%,60%,0.5))' }}
        />
      )}
      {/* Thumbnail */}
      <div className="relative shrink-0 m-2 rounded-xl overflow-hidden bg-gradient-to-br from-card to-black/60" style={{ width: 148, height: 86 }}>
        <img
          src={buildEpisodeImageUrl(ep, { showCover: animeImage, label: ep.episode, accent })}
          alt={`Episode ${ep.episode}`}
          loading="lazy"
          decoding="async"
          className={cn('h-full w-full object-cover', watched && !isCurrent && 'grayscale-[50%] opacity-60')}
          onError={(e) => {
            const img = e.currentTarget
            if (!img.dataset.fallbackTried && animeImage) {
              img.dataset.fallbackTried = '1'
              img.src = buildEpisodeImageUrl(null, { showCover: animeImage, label: ep.episode, accent })
            }
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        {/* EP badge */}
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/80 border border-white/10 px-1.5 py-0.5 text-[10px] font-bold font-mono text-white shadow">
          EP {ep.episode}
        </span>
        {fillerMark && (
          <span className={cn(
            'absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider shadow border',
            fillerMark === 'MIXED CANON' ? 'bg-purple-500/85 border-purple-400/40 text-white' : 'bg-amber-500/85 border-amber-400/40 text-white',
          )}>
            {fillerMark}
          </span>
        )}
        {/* Watched check */}
        {watched && !isCurrent && (
          <span className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-emerald-500 grid place-items-center shadow-md">
            <CheckCircle2 className="h-3 w-3 text-white" />
          </span>
        )}
        {isCurrent && (
          <span className="absolute inset-0 grid place-items-center bg-primary/30">
            <span className="h-9 w-9 rounded-full bg-primary/95 grid place-items-center shadow-lg shadow-primary/40">
              <Play className="h-4 w-4 text-white fill-white ml-0.5" />
            </span>
          </span>
        )}
      </div>
      {/* Text block */}
      <div className="min-w-0 flex-1 py-2 pr-3 flex flex-col justify-center gap-1">
        <p className={cn(
          'text-[13px] font-semibold leading-snug line-clamp-1',
          isCurrent ? 'text-white' : watched ? 'text-white/40 line-through decoration-white/20' : 'text-white/85 group-hover:text-white',
        )}>
          {epTitle || `Episode ${ep.episode}`}
        </p>
        {ep.overview && (
          <p className="text-[11px] leading-snug text-white/45 line-clamp-2">{ep.overview}</p>
        )}
        <div className="flex items-center gap-2.5 text-[10px] text-white/45 mt-0.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-white/12 px-1.5 py-0.5 font-bold tracking-wide text-white/65">
            <Captions className="h-3 w-3" /> CC
          </span>
          {score != null && !Number.isNaN(score) && (
            <span className="inline-flex items-center gap-1 font-semibold text-white/70">
              <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
              {score.toFixed(2)}
            </span>
          )}
          {airDate && <span className="ml-auto">{airDate}</span>}
          {isCurrent && (
            <span className="inline-flex items-center gap-1 font-bold text-primary uppercase tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              {streamTypeLabel}
            </span>
          )}
        </div>
      </div>
      {/* Progress bar */}
      {progressPct > 0 && !watched && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.04]">
          <div
            className={cn('h-full rounded-r-full transition-all duration-500', isMostlyDone ? 'bg-emerald-500/70' : 'bg-primary/60')}
            style={{ width: `${Math.max(3, progressPct)}%` }}
          />
        </div>
      )}
    </button>
  )
})

export default EpisodeRow
