import { Link } from 'react-router-dom'
import {
  Swords, Heart, Drama, Smile, Sparkles, Ghost, Rocket, Zap, Music2, BookOpen,
} from 'lucide-react'

// Hand-picked common Jikan genre IDs (https://docs.api.jikan.moe/)
const GENRES: Array<{
  id: number; name: string; icon: typeof Swords;
  color: string; glowColor: string;
}> = [
  { id: 1,  name: 'Action',     icon: Swords,   color: '#ef4444', glowColor: 'rgba(239,68,68,0.18)' },
  { id: 22, name: 'Romance',    icon: Heart,    color: '#f43f5e', glowColor: 'rgba(244,63,94,0.18)' },
  { id: 8,  name: 'Drama',      icon: Drama,    color: '#818cf8', glowColor: 'rgba(129,140,248,0.18)' },
  { id: 4,  name: 'Comedy',     icon: Smile,    color: '#f59e0b', glowColor: 'rgba(245,158,11,0.18)' },
  { id: 10, name: 'Fantasy',    icon: Sparkles, color: '#d946ef', glowColor: 'rgba(217,70,239,0.18)' },
  { id: 14, name: 'Horror',     icon: Ghost,    color: '#78716c', glowColor: 'rgba(120,113,108,0.18)' },
  { id: 24, name: 'Sci-Fi',     icon: Rocket,   color: '#06b6d4', glowColor: 'rgba(6,182,212,0.18)' },
  { id: 2,  name: 'Adventure',  icon: Zap,      color: '#10b981', glowColor: 'rgba(16,185,129,0.18)' },
  { id: 19, name: 'Music',      icon: Music2,   color: '#8b5cf6', glowColor: 'rgba(139,92,246,0.18)' },
  { id: 36, name: 'Slice of Life', icon: BookOpen, color: '#0ea5e9', glowColor: 'rgba(14,165,233,0.18)' },
]

export default function GenreTiles() {
  return (
    <section className="mt-8 mx-4">
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-5 w-5 text-accent" />
            <h2 className="text-xl font-bold text-white">Explore by Genre</h2>
          </div>
          <p className="text-sm text-muted-foreground">Find something that matches your mood</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {GENRES.map(({ id, name, icon: Icon, color, glowColor }) => (
          <Link
            key={id}
            to={`/browse?filter=genre&genreId=${id}`}
            className="group relative overflow-hidden rounded-xl glass-card flex items-center gap-3 p-3.5 transition-all duration-300"
          >
            {/* Icon circle — genre-coloured */}
            <div
              className="relative shrink-0 h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-200 group-hover:scale-105 group-hover:shadow-md"
              style={{
                background: `linear-gradient(135deg, ${color}22, ${color}44)`,
                border: `1px solid ${color}33`,
                boxShadow: `0 0 0 0 ${glowColor}`,
              }}
            >
              <Icon
                className="h-5 w-5 transition-all duration-200 group-hover:scale-105"
                style={{ color }}
                strokeWidth={1.8}
              />
              {/* Hover glow ring */}
              <div
                className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ boxShadow: `0 0 18px 2px ${glowColor}` }}
              />
            </div>

            {/* Label */}
            <div className="min-w-0">
              <span className="text-sm font-bold text-white group-hover:text-white transition-colors tracking-tight">
                {name}
              </span>
            </div>

            {/* Hover accent bar on the left edge */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full opacity-0 group-hover:opacity-100 transition-all duration-300"
              style={{ background: `linear-gradient(to bottom, ${color}, transparent)` }}
            />
          </Link>
        ))}
      </div>
    </section>
  )
}
