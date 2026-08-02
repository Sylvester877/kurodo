import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Home, Search, Compass, ArrowRight, Bookmark, Tv2, Star,
} from 'lucide-react'
import { getTrending } from '../api/anilist'
import { useTitle } from '../hooks/useTitle'
import { cn } from '../lib/utils'

// Random anime-themed quips shown on the 404 page
const QUIPS = [
  'This page got isekai\'d',
  'Even Gintoki can\'t find this page',
  'You took a wrong turn at the Shibuya Crossing',
  'Crunched by a Titan',
  '404 — Senpai didn\'t notice this URL',
  'This route is on a 100-year hiatus',
  'Lost in the Infinite Tsukuyomi',
]

export default function NotFound() {
  const location = useLocation()
  useTitle('Page not found')

  const [quip] = useState(() => QUIPS[Math.floor(Math.random() * QUIPS.length)])

  // Glitch effect: every few seconds, re-trigger the animation
  const [glitchKey, setGlitchKey] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setGlitchKey((k) => k + 1), 4500)
    return () => window.clearInterval(t)
  }, [])

  // Show 6 trending titles as suggestions so the user has somewhere to go
  const { data: trending = [] } = useQuery({
    queryKey: ['feed', 'trending'],
    queryFn: () => getTrending(18),
    staleTime: 30 * 60 * 1000,
  })
  const suggestions = trending.filter((m) => m.idMal).slice(0, 6)

  return (
    <div className="min-h-screen pt-20 pb-12 flex flex-col">
      {/* Decorative gradient blobs in the background */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none overflow-hidden"
        style={{ maskImage: 'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent)' }}
      >
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -top-20 right-0 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative max-w-[1100px] mx-auto px-4 flex-1 flex flex-col items-center justify-center text-center">
        {/* ───── 404 hero ───── */}
        <div className="relative mb-2 select-none">
          {/* Stacked glitch layers */}
          <h1
            key={glitchKey}
            className="text-[120px] sm:text-[180px] md:text-[220px] font-black leading-none tracking-tighter text-gradient relative"
            style={{ animation: 'glitch-shake 0.4s ease-out' }}
          >
            404
          </h1>
          <h1
            aria-hidden
            className="absolute inset-0 text-[120px] sm:text-[180px] md:text-[220px] font-black leading-none tracking-tighter text-primary opacity-30 mix-blend-screen pointer-events-none"
            style={{
              animation: 'glitch-offset-1 0.4s ease-out',
              transform: 'translate(2px, -2px)',
            }}
          >
            404
          </h1>
          <h1
            aria-hidden
            className="absolute inset-0 text-[120px] sm:text-[180px] md:text-[220px] font-black leading-none tracking-tighter text-accent opacity-30 mix-blend-screen pointer-events-none"
            style={{
              animation: 'glitch-offset-2 0.4s ease-out',
              transform: 'translate(-2px, 2px)',
            }}
          >
            404
          </h1>
        </div>

        {/* JP label */}
        <p className="font-jp text-xs text-white/30 tracking-[0.4em] mb-4">
          ページが 見つかりません
        </p>

        <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
          {quip}
        </h2>

        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-8">
          <span className="font-mono">{location.pathname}</span>
          <span className="text-white/20">·</span>
          <span>doesn't exist or has been moved</span>
        </div>

        {/* CTA buttons */}
        <div className="flex items-center justify-center gap-2 flex-wrap mb-12">
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-semibold transition-all shadow-[0_8px_24px_-8px_hsl(245,75%,60%,0.5)] hover:shadow-[0_12px_32px_-8px_hsl(245,75%,60%,0.7)] hover:-translate-y-0.5"
          >
            <Home className="h-4 w-4" /> Home
          </Link>
          <Link
            to="/browse"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl glass text-white border border-white/10 font-semibold hover:bg-white/10 hover:border-white/20 transition-all"
          >
            <Compass className="h-4 w-4" /> Browse
          </Link>
          <Link
            to="/search"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl glass text-white border border-white/10 font-semibold hover:bg-white/10 hover:border-white/20 transition-all"
          >
            <Search className="h-4 w-4" /> Search
          </Link>
          <Link
            to="/watchlist"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl glass text-white border border-white/10 font-semibold hover:bg-white/10 hover:border-white/20 transition-all"
          >
            <Bookmark className="h-4 w-4" /> My List
          </Link>
        </div>

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="w-full max-w-4xl">
            <div className="flex items-center gap-2 mb-4">
              <Tv2 className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-white">
                While you're here, check these out
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {suggestions.map((m) => {
                const title = m.title.english || m.title.romaji
                const cover = m.coverImage.extraLarge || m.coverImage.large || ''
                return (
                  <Link
                    key={m.id}
                    to={`/anime/${m.idMal}`}
                    className={cn(
                      'group block rounded-xl overflow-hidden glass-card card-tilt',
                      'border border-white/5 hover:border-primary/30',
                    )}
                  >
                    <div className="relative aspect-[3/4] overflow-hidden">
                      {cover && (
                        <img
                          src={cover}
                          alt={title}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/30 to-transparent" />
                      {m.averageScore && (
                        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 text-[10px] font-semibold bg-black/75 text-yellow-400 px-1.5 py-0.5 rounded">
                          <Star className="h-2.5 w-2.5 fill-yellow-400" />
                          {(m.averageScore / 10).toFixed(1)}
                        </div>
                      )}
                      <div className="absolute bottom-0 left-0 right-0 p-2">
                        <p className="text-[11px] font-semibold text-white line-clamp-2 leading-tight">
                          {title}
                        </p>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>

            <div className="text-center mt-6">
              <Link
                to="/browse"
                className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-semibold"
              >
                See all trending <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Local keyframes for the glitch effect */}
      <style>{`
        @keyframes glitch-shake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(-1px, 1px); }
          40% { transform: translate(1px, -1px); }
          60% { transform: translate(-2px, 0); }
          80% { transform: translate(2px, 0); }
        }
        @keyframes glitch-offset-1 {
          0% { transform: translate(0, 0); opacity: 0; }
          20% { transform: translate(4px, -4px); opacity: 0.5; }
          40% { transform: translate(2px, -2px); opacity: 0.3; }
          100% { transform: translate(2px, -2px); opacity: 0.3; }
        }
        @keyframes glitch-offset-2 {
          0% { transform: translate(0, 0); opacity: 0; }
          20% { transform: translate(-4px, 4px); opacity: 0.5; }
          40% { transform: translate(-2px, 2px); opacity: 0.3; }
          100% { transform: translate(-2px, 2px); opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
