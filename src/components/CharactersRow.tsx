import { useQuery } from '@tanstack/react-query'
import { getAnimeCharacters, type AnimeCharacter } from '../api/anilist'
import { proxifyImgUrl, cn } from '../lib/utils'
import { useShallow } from 'zustand/react/shallow'
import { useSettings } from '../store/useSettings'

function CircleSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2 w-[92px] shrink-0">
      <div className="h-[88px] w-[88px] rounded-full bg-white/[0.05] shimmer" />
      <div className="h-2.5 w-16 rounded bg-white/[0.05] shimmer" />
      <div className="h-2 w-10 rounded bg-white/[0.04] shimmer" />
    </div>
  )
}

function CastItem({ c }: { c: AnimeCharacter }) {
  const { reduceMotion } = useSettings(useShallow((s) => ({ reduceMotion: s.reduceMotion })))
  return (
    <div
      className="flex flex-col items-center gap-2 w-[92px] shrink-0 select-none"
      title={`${c.name}${c.voiceActor ? ` — CV: ${c.voiceActor.name}` : ''}`}
    >
      <div className="relative">
        <div
          className={cn(
            'h-[88px] w-[88px] rounded-full overflow-hidden ring-2 ring-white/10 bg-white/[0.04]',
            'transition-all duration-200 hover:ring-primary/60 hover:scale-105',
            !reduceMotion && 'hover:shadow-[0_0_20px_rgba(0,0,0,0.45)]',
          )}
        >
          {c.image ? (
            <img
              src={proxifyImgUrl(c.image)}
              alt={c.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full grid place-items-center">
              <span className="text-white/25 font-black text-2xl">
                {c.name.trim().charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
        {c.role === 'MAIN' && (
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase tracking-wider px-1.5 py-px rounded-full bg-primary/85 text-white shadow">
            Main
          </span>
        )}
      </div>
      <p className="text-[11px] font-medium text-white/85 text-center leading-tight line-clamp-2 min-h-[14px]">
        {c.name}
      </p>
      <p className="text-[10px] text-muted-foreground text-center leading-none truncate w-full px-1">
        {c.voiceActor ? `CV: ${c.voiceActor.name}` : c.nativeName || '\u00A0'}
      </p>
    </div>
  )
}

/**
 * Horizontal cast row for the details page (AniClover canon): circular
 * character avatars with the Japanese voice actor beneath. Renders null
 * when the anime has no character data or the query fails — never a
 * broken state.
 */
export default function CharactersRow({ malId }: { malId: number }) {
  const { data, isPending } = useQuery({
    queryKey: ['characters', malId],
    queryFn: () => getAnimeCharacters(malId),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    meta: { persist: true },
  })

  const chars = data ?? []
  if (!isPending && chars.length === 0) return null

  return (
    <section className="max-w-[1600px] mx-auto px-4 mt-14">
      <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent mb-8" />
      <div className="flex items-center gap-2 mb-5">
        <span className="kicker-bar" aria-hidden />
        <h2 className="text-lg sm:text-xl font-display font-bold text-white">Characters &amp; Cast</h2>
        {!isPending && (
          <span className="ml-1 mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {chars.length} shown
          </span>
        )}
      </div>

      {isPending ? (
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => <CircleSkeleton key={i} />)}
        </div>
      ) : (
        <div
          className="flex gap-2 overflow-x-auto custom-scrollbar pb-3 -mx-1 px-1 snap-x snap-mandatory"
          style={{
            maskImage: 'linear-gradient(to right, transparent, black 4%, black 96%, transparent)',
            WebkitMaskImage: 'linear-gradient(to right, transparent, black 4%, black 96%, transparent)',
          }}
        >
          {chars.map((c) => (
            <div key={c.id} className="snap-start">
              <CastItem c={c} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
