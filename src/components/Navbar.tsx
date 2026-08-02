import { memo, useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Search, Heart, Compass, Home, Bookmark, Menu, CalendarDays, Quote, X, Sparkles, Shuffle, Sun, Moon, BookOpen, Settings, Download, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '../lib/utils'
import Logo from './Logo'
import AccountMenu from './AccountMenu'
import NavbarSearchDropdown from './NavbarSearchDropdown'
import DownloadsManager from './DownloadsManager'
import { useSettings } from '../store/useSettings'
import { preloadHandlers } from '../lib/routePreloaders'
import type { DownloadEntry } from '../types'

export default memo(function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const lightMode = useSettings((s) => s.lightMode)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [activeDownloadCount, setActiveDownloadCount] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Auto-detect content type from route for the search dropdown.
  // /manga/* pages → manga search; everything else → anime search.
  const searchContentType: 'anime' | 'manga' =
    location.pathname.startsWith('/manga') ? 'manga' : 'anime'

  // Cinematic intro — navbar fades in after a delay on first visit.
  // Persisted to localStorage so it only plays once across sessions.
  const [introVisible, setIntroVisible] = useState(() => {
    if (typeof window === 'undefined') return true
    return !!localStorage.getItem('kurodo-cinematic-intro')
  })

  useEffect(() => {
    if (!introVisible) {
      const t = setTimeout(() => setIntroVisible(true), 300)
      return () => clearTimeout(t)
    }
  }, [introVisible])

  // Close the search dropdown when the route changes.
  useEffect(() => {
    setSearchOpen(false)
    setMobileOpen(false)
  }, [location.pathname])

  // Close the search dropdown when clicking outside.
  useEffect(() => {
    if (!searchOpen) return
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setSearchOpen(false)
    }
    window.addEventListener('click', onClick)
    return () => window.removeEventListener('click', onClick)
  }, [searchOpen])

  // Scroll-aware glassmorphism: intensify the navbar background once the
  // user scrolls past the hero. On the home page this keeps the hero
  // fully visible at the top, then transitions to a solid frosted-glass
  // bar as soon as content scrolls underneath.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Subscribe to download history for the navbar badge
  useEffect(() => {
    const api = (window as any).electronAPI
    if (!api?.onDownloadHistoryUpdate) return
    const cleanup = api.onDownloadHistoryUpdate((history: DownloadEntry[]) => {
      const active = history.filter(
        (d: DownloadEntry) => d.state === 'preparing' || d.state === 'downloading',
      ).length
      setActiveDownloadCount(active)
    })
    return () => cleanup?.()
  }, [])

  // ⌘K / Ctrl-K → focus the search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const links = [
    { to: '/',          label: 'Home',     icon: Home          },
    { to: '/browse',    label: 'Browse',   icon: Compass       },
    { to: '/manga',     label: 'Manga',    icon: BookOpen      },
    { to: '/schedule',  label: 'Schedule', icon: CalendarDays  },
    { to: '/seasonal',  label: 'Seasons',  icon: Sparkles      },
    { to: '/quotes',    label: 'Quotes',   icon: Quote         },
    { to: '/watchlist', label: 'My List',  icon: Bookmark      },
    { to: '/manga-list',label: 'Manga List',icon: BookOpen     },
    { to: '/settings',  label: 'Settings',  icon: Settings     },
  ]

  // Random anime discovery — picks from a curated range of well-known
  // MAL IDs (top 1000 popular shows). Avoids the old approach of random
  // 1-55000 which frequently landed on non-existent IDs (404).
  const goRandom = () => {
    // Curated spread across popular MAL IDs — covers shounen, romance,
    // isekai, slice-of-life, mecha, sports, etc. High hit rate.
    const POPULAR_IDS = [
      1, 5, 6, 7, 20, 21, 30, 32, 43, 1535, 16498, 30276, 11757, 11771,
      238, 477, 5114, 11061, 13601, 17265, 1735, 2001, 2251, 2889,
      30230, 31240, 31964, 32281, 33486, 35760, 36456, 37779, 38000,
      40028, 40748, 41025, 42203, 43299, 44037, 46095, 47917, 48583,
      5081, 6594, 6702, 7311, 8122, 8532, 9253, 934, 9919, 20507,
      21437, 21780, 22297, 2683, 276, 2904, 3002, 31251, 32937,
      33352, 34599, 35203, 3588, 3702, 37987, 39535, 4191, 467,
      476, 4794, 486, 489, 490, 497, 500, 507, 508, 513, 527, 530,
      568, 569, 578, 595, 596, 600, 604, 67, 675, 731, 750, 758,
      764, 766, 789, 791, 811, 814, 816, 820, 824, 842, 860, 861,
      863, 869, 872, 876, 918, 951, 975, 991, 996, 1490, 1575,
      1604, 1887, 1988, 1996, 2065, 2080, 2216, 2320, 237, 2499,
      250, 256, 257, 258, 2622, 267, 274, 278, 281, 292, 296, 297,
      299, 308, 339, 342, 351, 356, 368, 392, 395, 397, 407, 424,
      428, 431, 449, 470, 484, 493, 502, 511, 512, 522, 523, 529,
      534, 541, 543, 544, 546, 549, 552, 554, 562, 563, 565, 571,
      572, 574, 579, 582, 585, 587, 590, 592, 593, 594, 608, 609,
      612, 613, 614, 630, 633, 637, 640, 645, 677, 680, 686, 689,
      695, 704, 705, 710, 712, 713, 714, 715, 717, 718, 719, 728,
    ]
    const id = POPULAR_IDS[Math.floor(Math.random() * POPULAR_IDS.length)]
    navigate(`/anime/${id}`)
  }

  return (
    <nav
      className={cn(
        'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
        !introVisible && 'opacity-0 pointer-events-none',
        scrolled && 'bg-black/60 backdrop-blur-2xl border-b border-white/[0.06] shadow-lg shadow-black/20',
      )}
    >
      <div className="max-w-[1600px] mx-auto px-3 sm:px-4 lg:px-6 h-16 flex items-center justify-between gap-3">
        {/* ── Floating capsule: logo + nav links ─────────────────── */}
        <div className="flex items-center rounded-full border border-white/[0.08] bg-black/40 backdrop-blur-xl pl-4 pr-2 h-11 shadow-lg shadow-black/30">
          <Link to="/" className="shrink-0" aria-label="Kurōdo — home">
            <Logo size={26} />
          </Link>

          {/* Desktop nav — filled pill on the active route */}
          <div className="hidden md:flex items-center gap-0.5 ml-4">
            {links.map((link) => {
              const isActive = location.pathname === link.to
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  {...preloadHandlers(link.to)}
                  className={cn(
                    'relative px-3 py-1 rounded-full text-xs font-medium transition-colors duration-200',
                    isActive ? 'text-white' : 'text-white/45 hover:text-white/85',
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-full bg-white/[0.1] border border-white/[0.06]"
                      transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                    />
                  )}
                  <span className="relative z-10">{link.label}</span>
                </Link>
              )
            })}
          </div>
        </div>

        {/* ── Right: circular icon cluster ────────────────────────── */}
        <div ref={wrapRef} className="flex items-center gap-2">
          <button
            onClick={() => setSearchOpen((o) => !o)}
            aria-label="Search anime (⌘K)"
            title="Search (⌘K)"
            className={cn(
              'flex items-center justify-center h-10 w-10 rounded-full border border-white/[0.06] bg-black/80 text-white/55 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-150',
              searchOpen && 'text-white bg-white/[0.1] border-white/[0.15]',
            )}
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            onClick={goRandom}
            aria-label="Discover a random anime"
            title="Surprise me"
            className="hidden sm:flex items-center justify-center h-10 w-10 rounded-full border border-white/[0.06] bg-black/80 text-white/55 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-150"
          >
            <Shuffle className="h-4 w-4" />
          </button>

          <Link
            to="/watchlist"
            aria-label="Open watchlist"
            className="hidden sm:flex items-center justify-center h-10 w-10 rounded-full border border-white/[0.06] bg-black/80 text-white/55 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-150"
          >
            <Heart className="h-4 w-4" />
          </Link>

          {/* Light / dark mode toggle */}
          <button
            onClick={() => useSettings.getState().set('lightMode', !lightMode)}
            aria-label={lightMode ? 'Switch to dark mode' : 'Switch to light mode'}
            title={lightMode ? 'Dark mode' : 'Light mode'}
            className="hidden sm:flex items-center justify-center h-10 w-10 rounded-full border border-white/[0.06] bg-black/80 text-white/55 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-150"
          >
            {lightMode ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          {/* Downloads — Electron-only with active badge */}
          {(window as any).electronAPI?.isElectron && (
            <button
              onClick={() => setDownloadsOpen((o) => !o)}
              aria-label={`Downloads${activeDownloadCount > 0 ? ` — ${activeDownloadCount} active` : ''}`}
              title={`Downloads${activeDownloadCount > 0 ? ` — ${activeDownloadCount} active` : ''}`}
              className={cn(
                'relative flex items-center justify-center h-10 w-10 rounded-full border border-white/[0.06] bg-black/80 text-white/55 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-150',
                downloadsOpen && 'text-white bg-white/[0.1] border-white/[0.15]',
              )}
            >
              {activeDownloadCount > 0 ? (
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {activeDownloadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-indigo-500 text-[9px] font-bold text-white flex items-center justify-center shadow-[0_0_8px_rgba(99,102,241,0.5)]">
                  {activeDownloadCount}
                </span>
              )}
            </button>
          )}
          <AccountMenu />

          {/* Mobile menu toggle */}
          <button
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="md:hidden flex items-center justify-center h-10 w-10 rounded-full border border-white/[0.06] bg-black/80 text-white/65 hover:bg-white/[0.08] hover:border-white/[0.12] transition-colors duration-150"
            onClick={() => setMobileOpen((m) => !m)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* ── Search dropdown overlay ─────────────────────────────── */}
        {searchOpen && (
          <div className="absolute top-16 right-3 sm:right-4 lg:right-6 w-[min(440px,calc(100vw-1.5rem))] z-50">
            <NavbarSearchDropdown
              autoFocus
              placeholder={searchContentType === 'manga' ? 'Search manga…' : 'Search anime…'}
              contentType={searchContentType}
              onClose={() => setSearchOpen(false)}
            />
          </div>
        )}
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden mx-3 mt-2 rounded-2xl border border-white/[0.08] bg-black/92 overflow-hidden"
          >
            <div className="px-4 py-3 space-y-2">
              <NavbarSearchDropdown
                placeholder={searchContentType === 'manga' ? 'Search manga…' : 'Search anime…'}
                contentType={searchContentType}
                onClose={() => {
                  setMobileOpen(false)
                  setTimeout(() => navigate(location.pathname), 0)
                }}
              />

              <div className="pt-1 space-y-0.5">
                {links.map((link) => {
                  const Icon = link.icon
                  const isActive = location.pathname === link.to
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary/15 text-primary'
                          : 'text-white/60 hover:text-white hover:bg-white/[0.04]',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {link.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Downloads manager panel */}
      <DownloadsManager open={downloadsOpen} onClose={() => setDownloadsOpen(false)} />
    </nav>
  )
})