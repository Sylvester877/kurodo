import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, X, Home, Compass, CalendarDays, Bookmark, BarChart3,
  Settings as SettingsIcon, Send, Shield,
  Maximize, PlayCircle, PauseCircle, Heart, Film, ChevronRight,
  Sparkles, ArrowDown, ArrowUp, CornerDownLeft, Command as CommandIcon,
  Star, LogIn, LogOut, Trash2, MonitorPlay, Activity,
  Volume2, Captions,
} from 'lucide-react'
import { useDebounce } from '../hooks/useDebounce'
import { searchAnime } from '../api/anime'
import { useAuthStore } from '../store/useAuthStore'
import { useSettings } from '../store/useSettings'
import { useWatchListStore } from '../store/useWatchListStore'
import { flushAllActivity } from '../lib/sync'
import { clearPersistedCache } from '../lib/queryClient'
import { preloaderForPath } from '../lib/routePreloaders'
import { getSmallImageUrl, cn } from '../lib/utils'
import { toast } from './Toaster'
import type { Anime } from '../types'

/**
 * Generic command record. `kind` drives the icon column color; `keywords`
 * is fuzzy-matched (lowercase contains) when filtering.
 */
interface Command {
  id: string
  kind: 'nav' | 'action' | 'toggle' | 'anime' | 'episode' | 'recent'
  label: string
  hint?: string
  /** Optional second line, e.g. "Watching • EP 7 • 03:42 left" */
  detail?: string
  /** Keywords concatenated with label for the fuzzy filter. */
  keywords?: string
  icon: ReactNode
  /** When present, shows a small key shortcut on the right. */
  shortcut?: string
  /** Optional poster URL — when set we render it as the icon column. */
  poster?: string | null
  perform: () => void | Promise<void>
}

/**
 * Tiny fuzzy filter — case-insensitive substring + word-prefix bonus.
 * Returns -1 when no match. Higher score = better match.
 */
function score(query: string, label: string, keywords?: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const text = (label + ' ' + (keywords || '')).toLowerCase()
  if (!text.includes(q)) {
    // Subsequence fallback so "skp" matches "skip"
    let i = 0
    for (const c of text) if (c === q[i]) i++
    return i === q.length ? 0.2 : -1
  }
  // Exact prefix > word-prefix > substring
  if (text.startsWith(q)) return 10
  if (text.includes(' ' + q)) return 5
  return 2
}

/**
 * ⌘K command palette — search anime, navigate, toggle settings, jump to
 * recent shows, or fire one-off actions.
 *
 * Modes derived from the input prefix:
 *   "> …"  → actions only (Linear / Raycast convention)
 *   ":…"   → navigation only
 *   "ep N" → episode jump (when viewing a Watch page)
 *   else   → mixed (recents + nav + actions + anime search)
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const navigate = useNavigate()
  const location = useLocation()
  const params = useParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounced = useDebounce(query, 200)
  const trimmed = debounced.trim()

  const auth = useAuthStore((s) => s.auth)
  const signOut = useAuthStore((s) => s.signOut)
  const autoplayNext = useSettings((s) => s.autoplayNext)
  const autoSkipIntro = useSettings((s) => s.autoSkipIntro)
  const autoSkipOutro = useSettings((s) => s.autoSkipOutro)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  const pauseOnBlur = useSettings((s) => s.pauseOnBlur)
  const defaultTheaterMode = useSettings((s) => s.defaultTheaterMode)
  const captionSize = useSettings((s) => s.captionSize)
  const defaultVolume = useSettings((s) => s.defaultVolume)
  const setSettings = useSettings((s) => s.set)
  const continueWatching = useWatchListStore((s) => s.continueWatching)
  const watchlist = useWatchListStore((s) => s.watchlist)

  // ── Bind ⌘K globally ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't capture when an input/textarea already owns the keyboard
      // — except when the palette itself is open.
      const tag = (e.target as HTMLElement)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      if (open && e.key === 'Escape') {
        setOpen(false)
        return
      }
      // '/' to open like Discord/YouTube — only when nothing else has focus.
      if (!open && !inInput && e.key === '/') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // ── Reset on close ──────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setHighlight(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
    }
  }, [open])

  // ── Close on route change ───────────────────────────────────────
  useEffect(() => { setOpen(false) }, [location.pathname])

  // ── Debounced anime search ──────────────────────────────────────
  const searchQ = trimmed.length >= 2 && !trimmed.startsWith('>') && !trimmed.startsWith(':')
    ? trimmed
    : ''
  const { data: searchResults, isFetching } = useQuery({
    queryKey: ['command-search', searchQ],
    queryFn: () => searchAnime(searchQ, 1, 5),
    enabled: !!searchQ,
    staleTime: 60 * 1000,
  })

  // ── Build the command list based on the mode prefix ─────────────
  const commands: Command[] = useMemo(() => {
    const cmds: Command[] = []
    const mode: 'actions' | 'nav' | 'all' =
      trimmed.startsWith('>') ? 'actions'
      : trimmed.startsWith(':') ? 'nav'
      : 'all'
    // Strip the prefix for filtering
    const filterStr = mode === 'all' ? trimmed : trimmed.slice(1).trim()

    // ── Recently continued (top-of-list when input is empty) ──────
    if (mode === 'all' && !filterStr) {
      for (const c of continueWatching.slice(0, 5)) {
        cmds.push({
          id: `recent-${c.anime.mal_id}`,
          kind: 'recent',
          label: c.anime.title_english || c.anime.title,
          detail: `Resume EP ${c.episode}`,
          poster: getSmallImageUrl(c.anime),
          icon: <PlayCircle className="h-4 w-4 text-primary" />,
          perform: () => navigate(`/watch/${c.anime.mal_id}?ep=${c.episode}`),
        })
      }
    }

    // ── Episode jump (only on Watch page) ─────────────────────────
    const watchMalId = location.pathname.startsWith('/watch/') ? Number(params.id) : null
    const epMatch = trimmed.match(/^ep\s*(\d+)$/i)
    if (mode === 'all' && watchMalId && epMatch) {
      const n = Number(epMatch[1])
      cmds.push({
        id: `ep-jump-${n}`,
        kind: 'episode',
        label: `Jump to episode ${n}`,
        detail: 'Current anime',
        icon: <Film className="h-4 w-4 text-primary" />,
        perform: () => navigate(`/watch/${watchMalId}?ep=${n}`),
      })
    }

    // ── Navigation ────────────────────────────────────────────────
    if (mode !== 'actions') {
      const navEntries: Array<[string, ReactNode, string, string?]> = [
        ['Home', <Home className="h-4 w-4" />, '/', 'discover'],
        ['Browse', <Compass className="h-4 w-4" />, '/browse', 'top rated seasonal popular upcoming'],
        ['Schedule', <CalendarDays className="h-4 w-4" />, '/schedule', 'airing calendar week'],
        ['Watchlist', <Bookmark className="h-4 w-4" />, '/watchlist', 'my list saved bookmarks'],
        ['Profile', <BarChart3 className="h-4 w-4" />, '/profile', 'dashboard stats heatmap'],
        ['Activity', <Send className="h-4 w-4" />, '/activity', 'anilist post history feed muted'],
        ['Settings', <SettingsIcon className="h-4 w-4" />, '/settings', 'preferences config'],
        ['Health checks', <Activity className="h-4 w-4" />, '/health', 'diagnostics servers probes streaming issues'],
        ['Admin panel', <Shield className="h-4 w-4" />, '/admin', 'health scraper auth diagnostics'],
      ]
      for (const [label, icon, path, keywords] of navEntries) {
        cmds.push({
          id: `nav-${path}`,
          kind: 'nav',
          label,
          keywords,
          icon,
          perform: () => {
            preloaderForPath(path)()
            navigate(path)
          },
        })
      }
    }

    // ── Actions / toggles ─────────────────────────────────────────
    if (mode !== 'nav') {
      cmds.push({
        id: 'toggle-autoplay',
        kind: 'toggle',
        label: autoplayNext ? 'Disable autoplay next episode' : 'Enable autoplay next episode',
        hint: autoplayNext ? 'On' : 'Off',
        keywords: 'autoplay next continue',
        icon: autoplayNext ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />,
        perform: () => {
          setSettings('autoplayNext', !autoplayNext)
          toast.success(`Autoplay next ${autoplayNext ? 'OFF' : 'ON'}`)
        },
      })
      cmds.push({
        id: 'toggle-skip-intro',
        kind: 'toggle',
        label: autoSkipIntro ? 'Disable auto-skip intro' : 'Enable auto-skip intro',
        hint: autoSkipIntro ? 'On' : 'Off',
        keywords: 'op opening intro skip',
        icon: <Film className="h-4 w-4" />,
        perform: () => {
          setSettings('autoSkipIntro', !autoSkipIntro)
          toast.success(`Auto-skip intro ${autoSkipIntro ? 'OFF' : 'ON'}`)
        },
      })
      cmds.push({
        id: 'toggle-skip-outro',
        kind: 'toggle',
        label: autoSkipOutro ? 'Disable auto-skip outro' : 'Enable auto-skip outro',
        hint: autoSkipOutro ? 'On' : 'Off',
        keywords: 'ed ending outro skip credits',
        icon: <Film className="h-4 w-4" />,
        perform: () => {
          setSettings('autoSkipOutro', !autoSkipOutro)
          toast.success(`Auto-skip outro ${autoSkipOutro ? 'OFF' : 'ON'}`)
        },
      })
      cmds.push({
        id: 'toggle-reduce-motion',
        kind: 'toggle',
        label: reduceMotion ? 'Disable reduce motion' : 'Enable reduce motion',
        hint: reduceMotion ? 'On' : 'Off',
        keywords: 'a11y accessibility animation',
        icon: <MonitorPlay className="h-4 w-4" />,
        perform: () => {
          setSettings('reduceMotion', !reduceMotion)
          toast.success(`Reduce motion ${reduceMotion ? 'OFF' : 'ON'}`)
        },
      })
      cmds.push({
        id: 'toggle-pause-blur',
        kind: 'toggle',
        label: pauseOnBlur ? 'Disable pause on blur' : 'Enable pause on blur',
        hint: pauseOnBlur ? 'On' : 'Off',
        keywords: 'tab switch focus blur pause',
        icon: <PauseCircle className="h-4 w-4" />,
        perform: () => {
          setSettings('pauseOnBlur', !pauseOnBlur)
          toast.success(`Pause on blur ${pauseOnBlur ? 'OFF' : 'ON'}`)
        },
      })
      cmds.push({
        id: 'theater-mode',
        kind: 'action',
        label: 'Toggle theater mode',
        keywords: 'wide player sidebar T',
        shortcut: 'T',
        icon: <Maximize className="h-4 w-4" />,
        perform: () => {
          // Use the settings store instead of direct localStorage —
          // avoids split-brain where two sources of truth disagree.
          const current = defaultTheaterMode
          setSettings('defaultTheaterMode', !current)
          toast.info(`Theater mode ${current ? 'OFF' : 'ON'} — reloading…`, 1500)
          setTimeout(() => window.location.reload(), 600)
        },
      })

      // Activity-related
      if (auth) {
        cmds.push({
          id: 'flush-activity',
          kind: 'action',
          label: 'Flush pending AniList activity now',
          keywords: 'post send activity now',
          icon: <Send className="h-4 w-4 text-primary" />,
          perform: () => {
            flushAllActivity()
            toast.info('Posting buffered activity…', 2500)
          },
        })
      }

      // Caption shortcuts
      cmds.push({
        id: 'cc-bigger',
        kind: 'action',
        label: 'Make captions bigger',
        keywords: 'subtitle size font cc',
        icon: <Captions className="h-4 w-4" />,
        perform: () => {
          const next = Math.min(2, +(captionSize + 0.1).toFixed(1))
          setSettings('captionSize', next)
          toast.success(`Caption size ${Math.round(next * 100)}%`)
        },
      })
      cmds.push({
        id: 'cc-smaller',
        kind: 'action',
        label: 'Make captions smaller',
        keywords: 'subtitle size font cc',
        icon: <Captions className="h-4 w-4" />,
        perform: () => {
          const next = Math.max(0.7, +(captionSize - 0.1).toFixed(1))
          setSettings('captionSize', next)
          toast.success(`Caption size ${Math.round(next * 100)}%`)
        },
      })

      // Volume nudges (work even when player isn't focused)
      cmds.push({
        id: 'vol-up',
        kind: 'action',
        label: 'Volume +10%',
        keywords: 'audio sound louder',
        icon: <Volume2 className="h-4 w-4" />,
        perform: () => {
          const next = Math.min(1, +(defaultVolume + 0.1).toFixed(2))
          setSettings('defaultVolume', next)
          toast.success(`Default volume ${Math.round(next * 100)}%`)
        },
      })
      cmds.push({
        id: 'vol-down',
        kind: 'action',
        label: 'Volume −10%',
        keywords: 'audio sound quieter',
        icon: <Volume2 className="h-4 w-4" />,
        perform: () => {
          const next = Math.max(0, +(defaultVolume - 0.1).toFixed(2))
          setSettings('defaultVolume', next)
          toast.success(`Default volume ${Math.round(next * 100)}%`)
        },
      })

      // Sign-in
      if (!auth) {
        cmds.push({
          id: 'sign-in',
          kind: 'action',
          label: 'Sign in with AniList',
          keywords: 'login auth',
          icon: <LogIn className="h-4 w-4 text-primary" />,
          perform: () => {
            // We can't open the setup modal from here without prop drilling,
            // so route to settings which surfaces the same options.
            navigate('/settings')
          },
        })
      } else {
        cmds.push({
          id: 'sign-out',
          kind: 'action',
          label: 'Sign out',
          hint: auth.user.name,
          keywords: 'logout',
          icon: <LogOut className="h-4 w-4 text-red-300" />,
          perform: () => {
            signOut()
            toast.info('Signed out')
          },
        })
      }

      // Dangerous (last, color-coded red)
      cmds.push({
        id: 'reset-cache',
        kind: 'action',
        label: 'Reset cache & reload',
        keywords: 'clear localstorage corrupt rqueury',
        icon: <Trash2 className="h-4 w-4 text-red-300" />,
        perform: () => {
          if (confirm('Wipe the React Query cache + persisted snapshot, then reload?')) {
            clearPersistedCache()
            window.location.reload()
          }
        },
      })
    }

    // ── Watchlist quick-access (when typing 2+ chars) ─────────────
    if (mode === 'all' && filterStr.length >= 2) {
      for (const a of watchlist.slice(0, 30)) {
        cmds.push({
          id: `wl-${a.mal_id}`,
          kind: 'anime',
          label: a.title_english || a.title,
          detail: 'From your watchlist',
          poster: getSmallImageUrl(a),
          icon: <Heart className="h-4 w-4 text-red-300" />,
          perform: () => navigate(`/anime/${a.mal_id}`),
        })
      }
    }

    // ── Search results (live) ─────────────────────────────────────
    if (mode === 'all' && searchResults?.data?.length) {
      for (const a of searchResults.data) {
        cmds.push({
          id: `search-${a.mal_id}`,
          kind: 'anime',
          label: a.title_english || a.title,
          detail: [
            a.type,
            a.year,
            a.score && `★ ${a.score}`,
          ].filter(Boolean).join(' · '),
          poster: getSmallImageUrl(a as Anime),
          icon: <Star className="h-4 w-4 text-amber-300" />,
          perform: () => navigate(`/anime/${a.mal_id}`),
        })
      }
    }

    // Filter + score
    if (!filterStr) return cmds
    return cmds
      .map((c) => ({ c, s: score(filterStr, c.label, c.keywords) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
  }, [
    trimmed, navigate, location.pathname, params,
    continueWatching, watchlist,
    searchResults, auth, signOut,
    autoplayNext, autoSkipIntro, autoSkipOutro, reduceMotion,
    pauseOnBlur, defaultTheaterMode, captionSize, defaultVolume, setSettings,
  ])

  // ── Reset highlight when list changes ───────────────────────────
  useEffect(() => { setHighlight(0) }, [commands.length, debounced])

  // ── Keyboard nav within the list ────────────────────────────────
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (commands.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (h + 1) % commands.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (h - 1 + commands.length) % commands.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cmd = commands[highlight]
      if (cmd) {
        cmd.perform()
        setOpen(false)
      }
    }
  }

  // Auto-scroll highlighted row into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Command palette"
      className="fixed inset-0 z-[100] grid place-items-start pt-[15vh] px-4 bg-black/85 animate-[fadeInUp_0.1s_ease]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-2xl border border-primary/20 bg-card/95 shadow-lg shadow-black/40 overflow-hidden"
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <CommandIcon className="h-4 w-4 text-white/50 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={'Search, jump, toggle\u2026 (use ">" for actions, ":" for nav, "ep N" to jump episode)'}
            className="bg-transparent border-none outline-none text-sm w-full text-white placeholder:text-white/30 selection:bg-primary/30"
            aria-autocomplete="list"
          />
          {isFetching && searchQ ? (
            <span className="text-[10px] text-primary font-bold uppercase tracking-wider shrink-0">…</span>
          ) : query && (
            <button
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="text-white/40 hover:text-white"
              aria-label="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[55vh] overflow-y-auto custom-scrollbar"
        >
          {commands.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Search className="h-6 w-6 text-white/30 mx-auto mb-2" />
              <p className="text-sm text-white/55">No matches for "{trimmed}"</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Tip: type ":" to navigate, {'>'} for actions, or "ep N" on a Watch page.
              </p>
            </div>
          ) : (
            commands.map((c, i) => {
              const active = i === highlight
              return (
                <button
                  key={c.id}
                  data-cmd={i}
                  onClick={() => { c.perform(); setOpen(false) }}
                  onMouseMove={() => setHighlight(i)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    active
                      ? 'bg-primary/10 border-l-[3px] border-primary shadow-[inset_4px_0_12px_-6px_hsl(245,75%,60%,0.3)]'
                      : 'border-l-[3px] border-transparent hover:bg-white/5',
                  )}
                >
                  {c.poster ? (
                    <img
                      src={c.poster}
                      alt=""
                      className="h-9 w-7 rounded object-cover shrink-0 border border-white/8"
                    />
                  ) : (
                    <span className={cn(
                      'h-7 w-7 rounded-lg grid place-items-center shrink-0',
                      c.kind === 'nav' && 'bg-white/5 text-white/65',
                      c.kind === 'toggle' && 'bg-emerald-500/10 text-emerald-300',
                      c.kind === 'action' && 'bg-amber-400/10 text-amber-300',
                      c.kind === 'recent' && 'bg-primary/15 text-primary',
                      c.kind === 'episode' && 'bg-primary/15 text-primary',
                      c.kind === 'anime' && 'bg-white/5 text-white/65',
                    )}>
                      {c.icon}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{c.label}</p>
                    {c.detail && (
                      <p className="text-[11px] text-white/45 truncate">{c.detail}</p>
                    )}
                  </div>
                  {c.hint && (
                    <span className={cn(
                      'glass-pill text-[10px] uppercase tracking-wider font-bold py-0.5 px-1.5',
                      c.hint === 'On'
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-white/[0.08] text-white/45',
                    )}>
                      {c.hint}
                    </span>
                  )}
                  {c.shortcut && (
                    <kbd className="hidden sm:inline-flex glass-pill text-[10px] font-mono py-0.5 px-1.5 text-white/60">
                      {c.shortcut}
                    </kbd>
                  )}
                  {active && (
                    <ChevronRight className="h-3.5 w-3.5 text-primary shrink-0" />
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-white/5 flex items-center justify-between text-[10px] text-white/45">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <ArrowUp className="h-3 w-3" /><ArrowDown className="h-3 w-3" /> navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft className="h-3 w-3" /> open
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="glass-pill text-[10px] font-mono py-px px-1">esc</kbd> close
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary" />
            Kurōdo command bar
          </span>
        </div>
      </div>
    </div>
  )
}
