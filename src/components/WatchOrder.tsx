import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import {
  ArrowRight, Play, Star, ListOrdered,
} from 'lucide-react'
import { getAnimeRecommendations } from '../api/anime'

interface Props {
  malId: number
  title: string
  image: string
  type: string | null
  episodes: number | null
  score: number | null
}

/**
 * Watch Order section — shows the recommended viewing order for an anime
 * based on its relations (sequels, prequels, side stories) and recommendations.
 * Inspired by anidap.se's "Watch Order" feature on anime detail pages.
 */
export default function WatchOrder({ malId, title, image, type, episodes, score }: Props) {
  const recsQuery = useQuery({
    queryKey: ['anime', malId, 'recommendations'],
    queryFn: () => getAnimeRecommendations(malId),
    enabled: !!malId,
    staleTime: 60 * 60 * 1000,
    meta: { persist: true },
  })

  const recommendations = recsQuery.data?.data?.map((x) => x.entry).slice(0, 6) ?? []

  if (recsQuery.isLoading || recommendations.length === 0) return null

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-7 w-7 rounded-lg bg-cyan-500/15 grid place-items-center">
          <ListOrdered className="h-3.5 w-3.5 text-cyan-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white text-sm">Watch Order</h3>
          <p className="text-[10px] text-muted-foreground">Recommended viewing sequence</p>
        </div>
      </div>

      {/* Current anime */}
      <div className="mb-3">
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/10 border border-primary/30">
          <div className="relative h-12 w-8 shrink-0 rounded overflow-hidden bg-black/40">
            <img
              src={image}
              alt={title}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 grid place-items-center bg-black/40">
              <Play className="h-3 w-3 text-white fill-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider bg-primary text-white px-1.5 py-0.5 rounded">
                You are here
              </span>
              {type && (
                <span className="text-[9px] font-mono text-muted-foreground">{type}</span>
              )}
            </div>
            <p className="text-xs font-semibold text-white truncate mt-0.5">{title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {episodes && (
                <span className="text-[10px] text-muted-foreground">{episodes} episodes</span>
              )}
              {score && (
                <span className="text-[10px] text-amber-400 font-semibold flex items-center gap-0.5">
                  <Star className="h-2 w-2 fill-amber-400" />
                  {score.toFixed(1)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recommendations as "what to watch next" */}
      <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2 px-1">
        What to watch next
      </p>
      <div className="space-y-1.5">
        {recommendations.slice(0, 5).map((rec, idx) => (
          <motion.div
            key={rec.mal_id}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.2, delay: idx * 0.05 }}
          >
            <Link
              to={`/anime/${rec.mal_id}`}
              className="group flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-transparent hover:border-cyan-500/30 transition-all"
            >
              <span className="shrink-0 h-5 w-5 rounded-md bg-white/5 grid place-items-center text-[10px] font-mono text-muted-foreground group-hover:text-cyan-400 transition-colors">
                {idx + 1}
              </span>
              <div className="relative h-10 w-7 shrink-0 rounded overflow-hidden bg-black/40">
                {rec.images?.jpg?.image_url && (
                  <img
                    src={rec.images.jpg.image_url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-white truncate group-hover:text-cyan-300 transition-colors">
                  {rec.title}
                </p>
              </div>
              <ArrowRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:text-cyan-400 transition-all shrink-0" />
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Footer note */}
      <p className="text-[10px] text-muted-foreground mt-3 pt-2 border-t border-white/5 leading-relaxed">
        Watch order is based on community recommendations. For complex franchises,
        check the franchise page for a complete timeline.
      </p>
    </div>
  )
}
