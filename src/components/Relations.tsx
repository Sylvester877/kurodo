import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, GitBranch, Star } from 'lucide-react'
import { fetchRelations, type RelationEdge } from '../api/anilistAuth'
import { cn } from '../lib/utils'

interface Props {
  anilistId: number | null
  className?: string
}

const RELATION_LABEL: Record<string, string> = {
  PREQUEL: 'Prequel',
  SEQUEL: 'Sequel',
  PARENT: 'Parent story',
  SIDE_STORY: 'Side story',
  ALTERNATIVE: 'Alternative version',
  SUMMARY: 'Summary',
  CONTAINS: 'Contains',
  OTHER: 'Other',
}

// "Seasons only" scope per the user's preference — main story continuation
// (prequel/sequel/parent) PLUS alternative versions (remakes etc) and side
// stories. We skip spin-offs, character cameos, music videos, manga sources.
const SEASONS_TYPES = new Set([
  'PREQUEL', 'SEQUEL', 'PARENT', 'ALTERNATIVE', 'SIDE_STORY',
])

function score(e: RelationEdge): number {
  // Sort: parent → prequels → alt versions → side stories → sequels
  switch (e.relationType) {
    case 'PARENT':      return -100
    case 'PREQUEL':     return -10
    case 'ALTERNATIVE': return 0
    case 'SIDE_STORY':  return 5
    case 'SEQUEL':      return 10
    default:            return 50
  }
}

export default function Relations({ anilistId, className }: Props) {
  const [edges, setEdges] = useState<RelationEdge[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!anilistId) return
    let cancelled = false
    setLoading(true)
    setError(false)
    fetchRelations(anilistId)
      .then((r) => {
        if (cancelled) return
        const onlySeasons = r.filter((e) => SEASONS_TYPES.has(e.relationType))
        onlySeasons.sort((a, b) =>
          score(a) - score(b) ||
          (a.node.seasonYear ?? 0) - (b.node.seasonYear ?? 0))
        setEdges(onlySeasons)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setError(true)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [anilistId])

  if (!anilistId) return null
  if (loading) {
    return (
      <section className={cn('glass-card rounded-xl p-4', className)}>
        <div className="flex items-center gap-2 mb-3">
          <GitBranch className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-white">Related</h3>
        </div>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        </div>
      </section>
    )
  }
  if (error || !edges || edges.length === 0) return null

  return (
    <section className={cn('glass-card rounded-xl p-4', className)}>
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-white">
          Related
          <span className="ml-2 text-xs text-muted-foreground font-normal">
            {edges.length}
          </span>
        </h3>
      </div>

      <div className="space-y-2.5">
        {edges.map((e) => {
          const title = e.node.title.english || e.node.title.romaji
          const isPrequel = e.relationType === 'PREQUEL' || e.relationType === 'PARENT'
          const isSequel = e.relationType === 'SEQUEL'
          const href = e.node.idMal ? `/anime/${e.node.idMal}` : null

          const inner = (
            <div className="group flex gap-3 p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all">
              <div className="relative h-20 w-14 lg:h-[76px] lg:w-[56px] shrink-0 rounded-lg overflow-hidden bg-black/40 shadow-md">
                {e.node.coverImage.large && (
                  <img
                    src={e.node.coverImage.large}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-250"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1 flex flex-col justify-center">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isPrequel ? 'bg-blue-400' : isSequel ? 'bg-primary' : 'bg-white/30'
                      )}
                    />
                    {RELATION_LABEL[e.relationType] || e.relationType}
                  </span>
                </div>
                <p className="text-xs sm:text-sm font-semibold text-white/90 group-hover:text-primary transition-colors line-clamp-2 leading-tight">
                  {title}
                </p>
                <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1.5">
                  {e.node.format && (
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-white/10 text-white/70 px-1 rounded-sm">
                      {e.node.format}
                    </span>
                  )}
                  {e.node.episodes && (
                    <span className="text-[10px] text-muted-foreground">
                      {e.node.episodes} EPS
                    </span>
                  )}
                  {e.node.seasonYear && (
                    <span className="text-[10px] text-muted-foreground">
                      {e.node.seasonYear}
                    </span>
                  )}
                  {e.node.averageScore && (
                    <span className="flex items-center gap-0.5 text-[10px] text-yellow-400 font-semibold ml-auto">
                      <Star className="h-3 w-3 fill-yellow-400" />
                      {(e.node.averageScore / 10).toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )

          return href ? (
            <Link key={e.node.id} to={href} className="block">{inner}</Link>
          ) : (
            <div
              key={e.node.id}
              title="No MAL mapping — can't open in Kurōdo"
              className="opacity-50 cursor-not-allowed"
            >{inner}</div>
          )
        })}
      </div>
    </section>
  )
}
