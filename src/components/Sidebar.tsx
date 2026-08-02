import { memo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Home, Compass, BookOpen, CalendarDays, Sparkles, Quote, Bookmark, Settings,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { preloadHandlers } from '../lib/routePreloaders'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
}

const ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/browse', label: 'Browse', icon: Compass },
  { to: '/manga', label: 'Manga', icon: BookOpen },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays },
  { to: '/seasonal', label: 'Seasons', icon: Sparkles },
  { to: '/quotes', label: 'Quotes', icon: Quote },
  { to: '/watchlist', label: 'My List', icon: Bookmark },
  { to: '/settings', label: 'Settings', icon: Settings },
]

function Sidebar() {
  const location = useLocation()
  const [expanded, setExpanded] = useState(false)

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-white/[0.06] bg-black/70 backdrop-blur-2xl transition-[width] duration-300 lg:flex',
        expanded ? 'w-[180px]' : 'w-[var(--sidebar-rail-width)]',
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(e) => {
        // Collapse when focus leaves the sidebar entirely.
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setExpanded(false)
        }
      }}
      aria-label="Main navigation"
    >
      {/* Top spacer so links sit below the top navbar */}
      <div className="h-20 shrink-0" />

      <nav className="flex flex-1 flex-col gap-1 px-2.5 py-4">
        {ITEMS.map((item) => {
          const Icon = item.icon
          const isActive =
            item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)

          return (
            <Link
              key={item.to}
              to={item.to}
              {...preloadHandlers(item.to)}
              className={cn(
                'group relative flex h-11 items-center gap-3 rounded-xl transition-all duration-200',
                isActive
                  ? 'bg-white/10 text-white shadow-[0_0_16px_-4px_hsl(var(--theme-primary-h)_var(--theme-primary-s)_var(--theme-primary-l)/0.5)]'
                  : 'text-white/50 hover:bg-white/[0.06] hover:text-white',
                expanded ? 'px-3' : 'justify-center px-0',
              )}
            >
              {/* Active indicator pill */}
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute left-0 h-6 w-1 rounded-r-full bg-primary"
                  transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                />
              )}

              <Icon
                className={cn(
                  'h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110',
                  isActive && 'text-primary',
                )}
              />

              <span
                className={cn(
                  'whitespace-nowrap text-sm font-semibold transition-opacity duration-200',
                  expanded ? 'opacity-100' : 'w-0 opacity-0',
                )}
              >
                {item.label}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom brand mark */}
      <div
        className={cn(
          'flex h-16 items-center justify-center overflow-hidden border-t border-white/[0.06] text-[10px] font-bold uppercase tracking-[0.2em] text-white/20 transition-opacity duration-200',
          expanded ? 'opacity-100' : 'opacity-0',
        )}
      >
        Kurōdo
      </div>
    </aside>
  )
}

export default memo(Sidebar)
