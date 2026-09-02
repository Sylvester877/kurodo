import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Film, Play, Star } from 'lucide-react'
import { fetchRelations, type RelationEdge } from '../api/anilistAuth'
import { cn } from '../lib/utils'
import { ImageWithBlur } from './ImageWithBlur'

interface Props {
  anilistId: number | null
  className?: string
}

const RELATION_LABEL: Record<string, string> = {
  SEQUEL: 'Sequel',
  PREQUEL: 'Prequel',
  PARENT: 'Main series',
  SIDE_STORY: 'Side story',
  ALTERNATIVE: 'Alternative',
  SPIN_OFF: 'Spin-off',
  SUMMARY: 'Summary',
  CONTAINS: 'Contains',
  CHARACTER: 'Character',
  OTHER: 'Related',
}

// Badge tones — same palette language as the rest of the app
const RELATION_TONE: Record<string, string> = {
  PARENT: 'bg-blue-500/20 text-blue-300 border-blue-400/30',
  PREQUEL: 'bg-blue-500/15 text-blue-300 border-blue-400/25',
  SEQUEL: 'bg-primary/20 text-primary border-primary/40',
  ALTERNATIVE: 'bg-purple-500/20 text-purple-300 border-purple-400/30',
  SIDE_STORY: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
  SPIN_OFF: 'bg-amber-500/20 text-amber-300 border-amber-400/30',
  SUMMARY: 'bg-zinc-500/20 text-zinc-300 border-zinc-400/25',
  OTHER: 'bg-zinc-500/20 text-zinc-300 border-zinc-400/25',
  CONTAINS: 'bg-zinc-500/20 text-zinc-300 border-zinc-400/25',
  CHARACTER: 'bg-zinc-500/20 text-zinc-300 border-zinc-400/25',
}

function score(e: RelationEdge): number {
  // Sort: main series → prequels → sequels → side stories → alternatives →
  // spin-offs → everything else. Keeps the franchise spine first, like anikoto.
  switch (e.relationType) {
    case 'PARENT':      return -100
    case 'PREQUEL':     return -10
    case 'SEQUEL':      return 0
    case 'SIDE_STORY':  return 10
    case 'ALTERNATIVE': return 20
    case 'SPIN_OFF':    return 30
    default:            return 50
  }
}

/** Skeleton poster cards while relations load. */
function RelatedSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="w-[140px] sm:w-[158px] shrink-0">
          <div className="aspect-[2/3] rounded-xl bg-white/[0.04] border border-white/[0.06] animate-pulse" />
          <div className="mt-2 h-3 w-4/5 rounded bg-white/[0.06] animate-pulse" />
          <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/[0.04] animate-pulse" />
        </div>
      ))}
    </div>
  )
}

/**
 * Anikoto-style "Related" rail — the whole franchise for the show you're
 * watching (sequels, prequels, spin-offs, movies) as a horizontal poster
 * row. Replaces the old sidebar list: same AniList data, much better
 * discoverability, and it sits right under the player so scrolling reveals
 * it immediately.
 */
export default function RelatedAnime({ anilistId, className }: Props) {
  const [edges, setEdges] = useState<RelationEdge[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!anilistId) return
    let cancelled = false
    setLoading(true)
    fetchRelations(anilistId)
      .then((r) => {
        if (cancelled) return
        const sorted = [...r].sort(
          (a, b) => score(a) - score(b) ||
            (a.node.seasonYear ?? 0) - (b.node.seasonYear ?? 0),
        )
        setEdges(sorted)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setEdges([])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [anilistId])

  if (!anilistId) return null
  if (loading) {
    return (
      <section className={cn('max-w-[1600px] mx-auto px-4 mt-10', className)}>
        <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent mb-7" />
        <div className="flex items-center gap-2 mb-5">
          <span className="kicker-bar" aria-hidden />
          <h2 className="text-lg sm:text-xl font-display font-bold text-white flex items-center gap-2">
            Related
          </h2>
        </div>
        <RelatedSkeleton />
      </section>
    )
  }

  const visible = edges ?? []
  if (visible.length === 0) return null

  return (
    <section className={cn('max-w-[1600px] mx-auto px-4 mt-10', className)}>
      <div className="h-px bg-gradient-to-r from-transparent via-white/[0.04] to-transparent mb-7" />
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-2">
          <span className="kicker-bar" aria-hidden />
          <h2 className="text-lg sm:text-xl font-display font-bold text-white flex items-center gap-2">
            Related
          </h2>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25">
            {visible.length}
          </span>
        </div>
        <span className="hidden sm:inline text-[12px] text-white/40">
          Sequels · prequels · spin-offs
        </span>
      </div>

      {/* Horizontal poster rail — anikoto style */}
      <div className="flex gap-3 overflow-x-auto custom-scrollbar pb-3 -mx-1 px-1">
        {visible.map((e) => {
          const title = e.node.title.english || e.node.title.romaji || 'Untitled'
          const href = e.node.idMal ? `/anime/${e.node.idMal}` : null
          const label = RELATION_LABEL[e.relationType] || e.relationType
          const tone = RELATION_TONE[e.relationType] || RELATION_TONE.OTHER

          const card = (
            <div className="group relative w-[140px] sm:w-[158px] shrink-0 snap-start">
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-black/40 border border-white/[0.06] group-hover:border-primary/40 transition-all duration-300 shadow-lg group-hover:shadow-primary/20">
                {e.node.coverImage.large ? (
                  <ImageWithBlur
                    src={e.node.coverImage.large}
                    alt={title}
                    lazy
                    className="relative h-full w-full object-cover bg-zinc-900 transition-transform duration-300 group-hover:scale-105"
                    placeholderBlur={14}
                    fadeDuration={300}
                  />
                ) : (
                  <div className="h-full w-full grid place-items-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black">
                    <Film className="h-8 w-8 text-white/15" />
                  </div>
                )}

                {/* Relation badge */}
                <span
                  className={cn(
                    'absolute top-1.5 left-1.5 text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-md border backdrop-blur-sm',
                    tone,
                  )}
                >
                  {label}
                </span>

                {/* Score */}
                {e.node.averageScore != null && (
                  <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5 text-[10px] font-bold text-yellow-300 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm">
                    <Star className="h-2.5 w-2.5 fill-yellow-300" aria-hidden />
                    {(e.node.averageScore / 10).toFixed(1)}
                  </span>
                )}

                {/* Hover play overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-3">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-white">
                    <Play className="h-3.5 w-3.5 fill-white" aria-hidden />
                    Watch now
                  </span>
                </div>
              </div>

              <h4 className="mt-2 text-[13px] font-semibold text-white/85 group-hover:text-primary transition-colors line-clamp-2 leading-snug">
                {title}
              </h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1.5">
                {e.node.seasonYear && <span>{e.node.seasonYear}</span>}
                {e.node.format && <span className="truncate">{e.node.format}</span>}
                {e.node.episodes != null && (
                  <span className="shrink-0">· {e.node.episodes} EP</span>
                )}
              </p>
            </div>
          )

          return href ? (
            <Link key={e.node.id} to={href} className="block">
              {card}
            </Link>
          ) : (
            <div
              key={e.node.id}
              title="No MAL mapping — can't open in Kurōdo"
              className="opacity-50 cursor-not-allowed"
            >
              {card}
            </div>
          )
        })}
      </div>
    </section>
  )
}
