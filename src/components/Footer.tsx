import { Link } from 'react-router-dom'
import { Heart } from 'lucide-react'
import Logo from './Logo'

/** Anikage-style 3-column footer with structured link groups. */
export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] mt-auto relative overflow-hidden">
      <div aria-hidden className="absolute -top-32 -left-32 h-64 w-64 rounded-full bg-primary/5 blur-3xl pointer-events-none" />
      <div aria-hidden className="absolute -bottom-32 -right-32 h-64 w-64 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

      {/* Giant brand watermark — a premium signature mark behind the columns */}
      <div
        aria-hidden
        className="relative max-w-[1600px] mx-auto h-0 pointer-events-none select-none overflow-visible"
      >
        <span className="font-display absolute -bottom-8 right-2 sm:right-8 text-[110px] sm:text-[170px] lg:text-[220px] font-extrabold tracking-[-0.03em] leading-none text-white/[0.022] whitespace-nowrap">
          KURODO
        </span>
        <span className="font-jp absolute -bottom-16 right-[6px] sm:right-10 text-[150px] sm:text-[200px] leading-none text-white/[0.03]">
          黒道
        </span>
      </div>

      <div className="relative max-w-[1600px] mx-auto px-4 sm:px-8 lg:px-14 py-12">
        {/* ─── 3-column layout ─── */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-8 mb-10">
          {/* Column 1: Browse */}
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/30 mb-4">Browse</h4>
            <ul className="space-y-2.5">
              {[
                { to: '/browse', label: 'Catalog' },
                { to: '/browse?filter=top-rated', label: 'Top Rated' },
                { to: '/browse?filter=popular', label: 'Popular' },
                { to: '/browse?filter=seasonal', label: 'This Season' },
                { to: '/browse?filter=upcoming', label: 'Upcoming' },
              ].map(({ to, label }) => (
                <li key={to}>
                  <Link to={to} className="inline-block py-1.5 text-[13px] text-white/40 hover:text-white hover:translate-x-0.5 transition-all duration-200">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 2: Community */}
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/30 mb-4">Community</h4>
            <ul className="space-y-2.5">
              {[
                { to: '/schedule', label: 'Schedule' },
                { to: '/music', label: 'Music' },
              ].map(({ to, label }) => (
                <li key={to}>
                  <Link to={to} className="inline-block py-1.5 text-[13px] text-white/40 hover:text-white hover:translate-x-0.5 transition-all duration-200">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3: Kurōdo */}
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5 mb-4">
              <Link to="/" aria-label="Kurōdo — home">
                <Logo size={28} />
              </Link>
            </div>
            <p className="text-[13px] text-white/30 leading-relaxed mb-5 max-w-64">
              Premium anime streaming. Free, fast, and beautiful.
            </p>
            <ul className="space-y-2.5">
              {[
                { to: '/settings', label: 'Settings' },
                { to: '/watchlist', label: 'My List' },
                { to: '/manga-list', label: 'Manga List' },
              ].map(({ to, label }) => (
                <li key={to}>
                  <Link to={to} className="inline-block py-1.5 text-[13px] text-white/40 hover:text-white hover:translate-x-0.5 transition-all duration-200">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ─── Bottom bar ─── */}
        <div className="pt-6 border-t border-white/[0.04] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-white/25">
            <span>© 2026 Kurōdo</span>
            <span className="hidden sm:inline">·</span>
            <span>Does not host any videos</span>
            <span className="hidden sm:inline">·</span>
            <span>Content via third-party APIs</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="glass-pill text-[10px] font-bold uppercase tracking-wider text-primary border-primary/20 bg-primary/10">
              v{__APP_VERSION__}
            </span>
            <span className="glass-pill text-[10px] font-bold uppercase tracking-wider text-emerald-400 border-emerald-500/20 bg-emerald-500/10">
              <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
              Online
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-white/30">
              Made with
              <Heart className="h-3 w-3 fill-red-500 text-red-500 animate-pulse" />
            </span>
          </div>
        </div>
      </div>
    </footer>
  )
}