import { useState, useMemo, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Heart, Trash2, ArrowLeft, Play, Search, Grid3X3, List as ListIcon,
  SortAsc, Download, Upload, Cloud, ListMusic,
  ChevronDown, Filter, X, FileJson, GripVertical, Compass,
  CheckSquare, Square, AlertTriangle,
} from 'lucide-react'
import { useWatchListStore, type PlaylistStatus, type PlaylistMeta } from '../store/useWatchListStore'
import { useAuthStore } from '../store/useAuthStore'
import { useTitle } from '../hooks/useTitle'
import { getSmallImageUrl, getImageUrl } from '../lib/utils'
import { pullFromAniList } from '../lib/sync'
import { parseMalXml, malStatusToPlaylist } from '../lib/malXml'
import { getAnimeById } from '../api/anime'
import { toast } from '../components/Toaster'
import StaggerCard from '../components/StaggerCard'
import ImportPlaylistDialog from '../components/ImportPlaylistDialog'
import EmptyState from '../components/EmptyState'
import type { Anime } from '../types'

// ── Status badge helper ─────────────────────────────────────────
const STATUS_BADGE: Record<PlaylistStatus, { label: string; cls: string; dot: string }> = {
  CURRENT:   { label: 'Watching',      cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25', dot: 'bg-emerald-400' },
  WATCHING:  { label: 'Watching',      cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25', dot: 'bg-emerald-400' },
  PLANNING:  { label: 'Plan to Watch', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/25',          dot: 'bg-sky-400' },
  PLAN_TO_WATCH: { label: 'Plan to Watch', cls: 'bg-sky-500/10 text-sky-300 border-sky-500/25',      dot: 'bg-sky-400' },
  COMPLETED: { label: 'Completed',     cls: 'bg-violet-500/10 text-violet-300 border-violet-500/25',  dot: 'bg-violet-400' },
  PAUSED:    { label: 'Paused',        cls: 'bg-amber-500/10 text-amber-300 border-amber-500/25',     dot: 'bg-amber-400' },
  ON_HOLD:   { label: 'On Hold',       cls: 'bg-amber-500/10 text-amber-300 border-amber-500/25',     dot: 'bg-amber-400' },
  DROPPED:   { label: 'Dropped',       cls: 'bg-rose-500/10 text-rose-300 border-rose-500/25',        dot: 'bg-rose-400' },
  REPEATING: { label: 'Rewatching',    cls: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25',        dot: 'bg-cyan-400' },
}

type ViewMode = 'grid' | 'list'
type SortBy = 'recent' | 'title' | 'score' | 'progress'

export default function WatchList() {
  const watchlist = useWatchListStore((s) => s.watchlist)
  const removeFromWatchlist = useWatchListStore((s) => s.removeFromWatchlist)
  const getWatchedCount = useWatchListStore((s) => s.getWatchedCount)
  const addToWatchlist = useWatchListStore((s) => s.addToWatchlist)
  const reorderWatchlist = useWatchListStore((s) => s.reorderWatchlist)
  const getPlaylistMeta = useWatchListStore((s) => s.getPlaylistMeta)
  const setPlaylistMetaBatch = useWatchListStore((s) => s.setPlaylistMetaBatch)
  const auth = useAuthStore((s) => s.auth)
  useTitle('My List')

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem('kurodo-watchlist-view') as ViewMode) || 'grid' } catch { return 'grid' }
  })
  const [sortBy, setSortBy] = useState<SortBy>('recent')
  const [query, setQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<PlaylistStatus | 'all'>('all')
  const [showImport, setShowImport] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [showPlaylistDialog, setShowPlaylistDialog] = useState(false)
  // Bulk-select ("Remove from my list") — toggleable from the header.
  // When on, each card shows a checkbox and clicks toggle selection
  // instead of navigating. Exiting select mode clears the selection.
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [pendingBulkRemove, setPendingBulkRemove] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Persist view mode
  const saveViewMode = useCallback((v: ViewMode) => {
    setViewMode(v)
    try { localStorage.setItem('kurodo-watchlist-view', v) } catch { /* ignore */ }
  }, [])

  const sortedAndFiltered = useMemo(() => {
    let list = [...watchlist]
    if (query.trim()) {
      const q = query.toLowerCase().trim()
      list = list.filter((a) =>
        (a.title_english || a.title).toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q)
      )
    }
    // Status filter — uses playlistMeta for imported shows, skips non-imported when filtering
    if (filterStatus !== 'all') {
      list = list.filter((a) => getPlaylistMeta(a.mal_id)?.status === filterStatus)
    }
    switch (sortBy) {
      case 'title':
        list.sort((a, b) => (a.title_english || a.title).localeCompare(b.title_english || b.title))
        break
      case 'score':
        list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        break
      case 'progress': {
        list.sort((a, b) => {
          const pa = a.episodes ? (getWatchedCount(a.mal_id) / a.episodes) : 0
          const pb = b.episodes ? (getWatchedCount(b.mal_id) / b.episodes) : 0
          return pb - pa
        })
        break
      }
      case 'recent':
      default:
        // watchlist is already in insertion order (recent first)
        break
    }
    return list
  }, [watchlist, query, sortBy, filterStatus, getWatchedCount, getPlaylistMeta])

  const exportJson = () => {
    const payload = {
      kind: 'kurodo-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      watchlist,
      watchedEpisodes: useWatchListStore.getState().watchedEpisodes,
      continueWatching: useWatchListStore.getState().continueWatching,
      watchHistory: useWatchListStore.getState().watchHistory,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kurodo-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
    toast.success('Exported watchlist to JSON')
  }

  const importJson = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (data.kind !== 'kurodo-export') throw new Error('Not a Kurōdo backup file')
        let added = 0
        for (const anime of (data.watchlist ?? []) as Anime[]) {
          if (!watchlist.some((a) => a.mal_id === anime.mal_id)) {
            addToWatchlist(anime)
            added++
          }
        }
        toast.success(`Imported ${added} anime${added === 1 ? '' : 's'}`)
      } catch (e) {
        toast.error('Import failed: ' + (e as Error).message)
      }
    }
    input.click()
  }

  const importMalXml = async (file: File) => {
    setImporting('mal-xml')
    try {
      const text = await file.text()
      const entries = parseMalXml(text)
      if (entries.length === 0) {
        toast.info('No anime entries found in this XML file')
        return
      }
      setImportProgress({ current: 0, total: entries.length })
      let added = 0
      let skipped = 0
      const queue = [...entries]
      const BATCH_SIZE = 3
      // Track PlaylistMeta so the imported items get their real MAL status
      // badge (Watching / Plan to Watch / On Hold / Completed / Dropped).
      // Without this, every imported item shows as "Completed" once the
      // watchedEpisodes == total heuristic kicks in on /profile.
      const metaBatch: Array<{ malId: number; meta: PlaylistMeta }> = []
      while (queue.length > 0) {
        const batch = queue.splice(0, BATCH_SIZE)
        await Promise.all(
          batch.map(async (entry) => {
            if (watchlist.some((a) => a.mal_id === entry.malId)) {
              skipped++
              setImportProgress((p) => ({ ...p, current: p.current + 1 }))
              return
            }
            try {
              const full = await getAnimeById(entry.malId)
              if (full?.data) {
                addToWatchlist(full.data)
              } else {
                addToWatchlist(makeStubAnime(entry))
              }
              metaBatch.push({
                malId: entry.malId,
                meta: {
                  status: malStatusToPlaylist(entry.status),
                  score: entry.score,
                  watchedEpisodes: entry.watchedEpisodes,
                  source: 'mal',
                  importedAt: Date.now(),
                },
              })
              added++
            } catch {
              // Skip on error
            }
            setImportProgress((p) => ({ ...p, current: p.current + 1 }))
          })
        )
        // Small delay between batches to respect Jikan rate limits
        if (queue.length > 0) await new Promise((r) => setTimeout(r, 350))
      }
      // Single batched write → one re-render instead of N.
      if (metaBatch.length > 0) setPlaylistMetaBatch(metaBatch)
      toast.success(`Added ${added} from MAL XML · ${skipped} already in list`)
    } catch (e) {
      toast.error('MAL XML import failed: ' + (e as Error).message)
    } finally {
      setImporting(null)
      setImportProgress({ current: 0, total: 0 })
    }
  }

  const importAniList = async () => {
    if (!auth) {
      toast.info('Sign in to AniList first to sync your list')
      return
    }
    setImporting('anilist')
    try {
      await pullFromAniList()
    } finally {
      setImporting(null)
    }
  }

  // Build a minimal Anime stub from a MAL XML entry when Jikan doesn't
  // have a match (rate-limited, deleted, private, etc.). Colors and
  // images are intentionally blank so the stub still satisfies the Anime
  // type without pulling in placeholder data the user didn't import.
  const makeStubAnime = (entry: { malId: number; title: string; type: string; episodes: number | null; score: number }): Anime => ({
    mal_id: entry.malId,
    title: entry.title,
    title_english: entry.title,
    title_japanese: null,
    synopsis: null,
    score: entry.score || null,
    scored_by: null, rank: null, popularity: null, members: null, favorites: null,
    images: {
      jpg: { image_url: '', small_image_url: '', large_image_url: '' },
      webp: { image_url: '', small_image_url: '', large_image_url: '' },
    },
    trailer: {
      youtube_id: null, url: null, embed_url: null,
      images: { image_url: null, small_image_url: null, medium_image_url: null, large_image_url: null, maximum_image_url: null },
    },
    type: entry.type,
    status: '', episodes: entry.episodes,
    duration: null, rating: null,
    aired: { from: null, to: null, string: null },
    season: null, year: null,
    genres: [], studios: [], themes: [], demographics: [],
  })

  const totalWatched = useMemo(() => {
    return watchlist.reduce((sum, a) => sum + getWatchedCount(a.mal_id), 0)
  }, [watchlist, getWatchedCount])

  // ── Bulk-select ("Remove from my list") helpers ─────────────────
  // The visibleIds set drives "Select all" inside the bulk-select bar.
  // Using sortedAndFiltered (not the full watchlist) keeps "Select all"
  // scoped to what the user currently sees — respects active search /
  // status filter so users don't accidentally delete hidden entries.
  const visibleIds = useMemo(
    () => new Set(sortedAndFiltered.map((a) => a.mal_id)),
    [sortedAndFiltered],
  )
  const allSelected = visibleIds.size > 0 && selectedIds.size === visibleIds.size

  const toggleSelection = useCallback((malId: number) => {
    setSelectedIds((cur) => {
      const next = new Set(cur)
      if (next.has(malId)) next.delete(malId)
      else next.add(malId)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((cur) =>
      cur.size === visibleIds.size && visibleIds.size > 0
        ? new Set()                        // all selected → clear
        : new Set(visibleIds),             // partial or none → select all visible
    )
  }, [visibleIds])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const performBulkRemove = useCallback(() => {
    if (selectedIds.size === 0) {
      setPendingBulkRemove(false)
      return
    }
    const count = selectedIds.size
    // removeFromWatchlist already fires the syncRemove callback when
    // signed in to AniList, so deleting on the remote happens automatically.
    ;[...selectedIds].forEach((id) => removeFromWatchlist(id))
    toast.info(`Removed ${count} ${count === 1 ? 'anime' : 'anime'} from your list`)
    setPendingBulkRemove(false)
    exitSelectMode()
  }, [selectedIds, removeFromWatchlist, exitSelectMode])

  // Drag-and-drop is only allowed when sorted naturally (recent = insertion order)
  const isDraggable = sortBy === 'recent' && !query && filterStatus === 'all'
  const dragItem = useRef<number | null>(null)
  const dragEnterCounter = useRef(0)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [dragActive, setDragActive] = useState(false)

  return (
    <div className="pt-20 pb-12 mx-4 max-w-[1600px] xl:mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Link to="/" className="flex items-center gap-1 text-sm text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
      </div>

      {/* Import Playlist dialog (AniList + MAL) */}
      <ImportPlaylistDialog
        open={showPlaylistDialog}
        onClose={() => setShowPlaylistDialog(false)}
      />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-white">My Watchlist</h1>
            {auth && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                <Cloud className="h-3 w-3" />
                Syncing
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {watchlist.length === 0
              ? 'Add anime to your watchlist to keep track of what to watch'
              : `${watchlist.length} anime · ${totalWatched} episodes watched${auth ? ` · synced to ${auth.user.name}` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPlaylistDialog(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 text-primary border border-primary/40 hover:bg-primary/30 transition-colors shadow-[0_0_16px_-6px_hsl(245,75%,60%,0.3)]"
          >
            <ListMusic className="h-3.5 w-3.5" />
            Import playlist
          </button>
          {/* "Remove from my list" — when active, switches the cards into
              multi-select mode and reveals the bulk-action bar below. */}
          {watchlist.length > 0 && (
            <button
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              aria-pressed={selectMode}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                selectMode
                  ? 'bg-red-500/20 text-red-300 border-red-500/40 hover:bg-red-500/30'
                  : 'bg-white/[0.04] text-white/70 border-white/8 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              {selectMode ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
              {selectMode ? 'Done' : 'Select'}
            </button>
          )}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06]">
            <button
              onClick={() => setShowImport((s) => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] text-white/70 border border-white/8 hover:bg-white/[0.08] hover:text-white transition-colors"
            >
              <Upload className="h-3.5 w-3.5" />
              Backup
            </button>
            <button
              onClick={() => saveViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] text-white/70 border border-white/8 hover:bg-white/[0.08] hover:text-white transition-colors"
              title={viewMode === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
            >
              {viewMode === 'grid' ? <ListIcon className="h-3.5 w-3.5" /> : <Grid3X3 className="h-3.5 w-3.5" />}
              {viewMode === 'grid' ? 'List' : 'Grid'}
            </button>
          </div>
        </div>
      </div>

      {/* Import / Export panel */}
      {showImport && (
        <div className="glass-card rounded-xl p-4 mb-6 animate-[fadeInUp_0.2s_ease]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Download className="h-4 w-4 text-primary" />
              Import & Export
            </h3>
            <button onClick={() => setShowImport(false)} className="text-muted-foreground hover:text-white transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* AniList import */}
            <button
              onClick={importAniList}
              disabled={!!importing}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-primary/20 transition-all text-left disabled:opacity-50"
            >
              <div className="h-9 w-9 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
                <Cloud className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">AniList</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {importing === 'anilist' ? 'Pulling list…' : auth ? 'Pull your AniList library' : 'Sign in first'}
                </p>
              </div>
            </button>

            {/* MAL XML import */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!!importing}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-primary/20 transition-all text-left disabled:opacity-50"
            >
              <div className="h-9 w-9 rounded-lg bg-blue-500/15 grid place-items-center shrink-0">
                <FileJson className="h-4 w-4 text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">MAL XML</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {importing === 'mal-xml' ? `Importing ${importProgress.current}/${importProgress.total}…` : 'Import MAL export XML'}
                </p>
              </div>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xml,application/xml"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) importMalXml(f)
                e.target.value = ''
              }}
            />

            {/* Kurōdo JSON import */}
            <button
              onClick={importJson}
              disabled={!!importing}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-primary/20 transition-all text-left disabled:opacity-50"
            >
              <div className="h-9 w-9 rounded-lg bg-amber-500/15 grid place-items-center shrink-0">
                <FileJson className="h-4 w-4 text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">Kurōdo JSON</p>
                <p className="text-[11px] text-muted-foreground truncate">Import from a backup file</p>
              </div>
            </button>

            {/* Export */}
            <button
              onClick={exportJson}
              className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition-colors text-left"
            >
              <div className="h-9 w-9 rounded-lg bg-primary/15 grid place-items-center shrink-0">
                <Download className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">Export</p>
                <p className="text-[11px] text-muted-foreground truncate">Save everything to JSON</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Bulk-action bar — replaces filter/sort toolbar when in select mode */}
      {selectMode && watchlist.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-5 p-3 rounded-xl border border-red-500/20 bg-red-500/[0.04]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={toggleSelectAll}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-white/[0.06] text-white/80 border border-white/10 hover:bg-white/[0.12] transition-colors"
              title={allSelected ? 'Deselect all' : 'Select all visible'}
            >
              {allSelected ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-white/60" />}
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
            <span className="text-[11px] text-white/70 tabular-nums">
              <span className="font-bold text-white">{selectedIds.size}</span>
              {' / '}
              <span className="text-white/50">{visibleIds.size}</span>
              {' selected'}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <button
              onClick={exitSelectMode}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-white/70 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white border border-white/8 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setPendingBulkRemove(true)}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-red-500 text-white hover:bg-red-600 disabled:bg-white/5 disabled:text-white/30 disabled:cursor-not-allowed transition-colors shadow-[0_4px_16px_-6px_rgba(239,68,68,0.5)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove {selectedIds.size > 0 ? `${selectedIds.size} ` : ''}from list
            </button>
          </div>
        </div>
      )}

      {/* Toolbar: search + sort + filter */}
      {!selectMode && watchlist.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-5">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 flex-1 max-w-md w-full">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your list…"
              className="flex-1 bg-transparent border-none outline-none text-sm text-white placeholder:text-muted-foreground"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-white">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Drag indicator */}
            {isDraggable && (
              <span className="hidden sm:flex items-center gap-1 text-[10px] text-white/30 uppercase tracking-wider font-semibold px-2 py-1">
                <GripVertical className="h-3 w-3" />
                Drag to reorder
              </span>
            )}
            {/* Status filter dropdown */}
            <div className="relative group">
              <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white/[0.04] text-white/70 border border-white/8 hover:bg-white/[0.08] hover:text-white transition-colors">
                <Filter className="h-3.5 w-3.5" />
                {filterStatus === 'all'
                  ? 'All statuses'
                  : (STATUS_BADGE[filterStatus]?.label ?? filterStatus)}
                <ChevronDown className="h-3 w-3" />
              </button>
              <div className="absolute top-full right-0 mt-1 w-44 rounded-lg bg-black/92 border border-white/10 shadow-lg overflow-hidden opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-20">
                {([
                  { value: 'all' as const, label: 'All statuses' },
                  { value: 'WATCHING' as PlaylistStatus, label: 'Watching' },
                  { value: 'PLAN_TO_WATCH' as PlaylistStatus, label: 'Plan to Watch' },
                  { value: 'COMPLETED' as PlaylistStatus, label: 'Completed' },
                  { value: 'DROPPED' as PlaylistStatus, label: 'Dropped' },
                  { value: 'ON_HOLD' as PlaylistStatus, label: 'On Hold' },
                  { value: 'PAUSED' as PlaylistStatus, label: 'Paused' },
                  { value: 'REPEATING' as PlaylistStatus, label: 'Rewatching' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFilterStatus(opt.value)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center gap-2 ${
                      filterStatus === opt.value ? 'text-primary bg-primary/5' : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {opt.value !== 'all' && (
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_BADGE[opt.value].dot}`} />
                    )}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative group">
              <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white/[0.04] text-white/70 border border-white/8 hover:bg-white/[0.08] hover:text-white transition-colors">
                <SortAsc className="h-3.5 w-3.5" />
                {sortBy === 'recent' && 'Recently added'}
                {sortBy === 'title' && 'Title'}
                {sortBy === 'score' && 'Score'}
                {sortBy === 'progress' && 'Progress'}
                <ChevronDown className="h-3 w-3" />
              </button>
              <div className="absolute top-full right-0 mt-1 w-40 rounded-lg bg-black/90 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-20">
                {([
                  { value: 'recent' as SortBy, label: 'Recently added' },
                  { value: 'title' as SortBy, label: 'Title' },
                  { value: 'score' as SortBy, label: 'Score' },
                  { value: 'progress' as SortBy, label: 'Progress' },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSortBy(opt.value)}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      sortBy === opt.value ? 'text-primary bg-primary/5' : 'text-white/70 hover:bg-white/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {watchlist.length === 0 ? (
        <EmptyState
          icon={<Heart className="h-full w-full" />}
          title="Your list is empty"
          description="Start browsing and add anime to your watchlist to keep track of everything you want to watch."
        >
          <Link
            to="/browse"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition-all shadow-[0_8px_24px_-8px_hsl(245,75%,60%,0.45)] hover:shadow-[0_12px_32px_-8px_hsl(245,75%,60%,0.6)] hover:-translate-y-0.5"
          >
            <Compass className="h-4 w-4" /> Browse Anime
          </Link>
          <button
            onClick={() => setShowPlaylistDialog(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/[0.04] text-white/80 border border-white/10 font-semibold text-sm hover:bg-white/[0.08] hover:border-primary/30 transition-all"
          >
            <ListMusic className="h-4 w-4" /> Import Playlist
          </button>
        </EmptyState>
      ) : sortedAndFiltered.length === 0 ? (
        <div className="text-center py-16">
          <Filter className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-30" />
          {filterStatus !== 'all' ? (
            <>
              <p className="text-white/80 font-medium">
                No anime with status &ldquo;{STATUS_BADGE[filterStatus]?.label ?? filterStatus}&rdquo;
                {query && <> matching &ldquo;{query}&rdquo;</>}
              </p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <button onClick={() => { setFilterStatus('all'); setQuery('') }} className="text-sm text-primary hover:underline">
                  Show all
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-white/80 font-medium">No matches for &ldquo;{query}&rdquo;</p>
              <button onClick={() => setQuery('')} className="text-sm text-primary hover:underline mt-1">
                Clear search
              </button>
            </>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-x-3 gap-y-5">
          {sortedAndFiltered.map((anime, i) => {
            const watched = getWatchedCount(anime.mal_id)
            const total = anime.episodes ?? 0
            const progress = total > 0 ? Math.round((watched / total) * 100) : 0
            const meta = getPlaylistMeta(anime.mal_id)
            const isSelected = selectedIds.has(anime.mal_id)
            return (
              <StaggerCard key={anime.mal_id} index={i}>
              <div
                onClick={selectMode ? () => toggleSelection(anime.mal_id) : undefined}
                className={`group relative rounded-xl bg-card border overflow-hidden transition-all duration-200 ${
                  selectMode
                    ? `cursor-pointer ${isSelected ? 'border-red-500/70 ring-2 ring-red-500/40' : 'border-white/5 hover:border-white/20'}`
                    : isDraggable
                    ? `border-white/5 hover:border-primary/30 hover:shadow-[0_0_24px_-8px_hsl(245,75%,60%,0.12)] cursor-grab active:cursor-grabbing ${dragOverIdx === i ? 'border-primary/60 shadow-[0_0_32px_-8px_hsl(245,75%,60%,0.3)] scale-[1.03] ring-1 ring-primary/30' : ''} ${dragActive && dragItem.current === i ? 'opacity-50 scale-95' : ''}`
                    : 'border-white/5 hover:border-primary/30 hover:shadow-[0_0_24px_-8px_hsl(245,75%,60%,0.12)]'
                }`}
                draggable={isDraggable}
                onDragStart={(e) => {
                  if (!isDraggable) return
                  dragItem.current = i
                  setDragActive(true)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(i))
                }}
                onDragEnd={() => {
                  dragItem.current = null
                  dragEnterCounter.current = 0
                  setDragOverIdx(null)
                  setDragActive(false)
                }}
                onDragEnter={(e) => {
                  e.preventDefault()
                  dragEnterCounter.current++
                  setDragOverIdx(i)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDragLeave={() => {
                  dragEnterCounter.current--
                  if (dragEnterCounter.current <= 0) {
                    dragEnterCounter.current = 0
                    setDragOverIdx(null)
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dragEnterCounter.current = 0
                  setDragOverIdx(null)
                  const fromIndex = dragItem.current
                  if (fromIndex !== null && fromIndex !== i) {
                    reorderWatchlist(fromIndex, i)
                  }
                  dragItem.current = null
                  setDragActive(false)
                }}
              >
                {/* Selection checkbox — top-left in select mode, replaces the
                    "GripVertical" drag handle position to keep the layout
                    consistent across both modes. */}
                {selectMode ? (
                  <div className={`absolute top-2 left-2 z-10 transition-opacity ${isSelected ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}>
                    <div className={`h-6 w-6 rounded-md grid place-items-center border-2 transition-colors ${
                      isSelected ? 'bg-red-500 border-red-500' : 'border-white/40 bg-black/40'
                    }`}>
                      {isSelected && <CheckSquare className="h-4 w-4 text-white" />}
                    </div>
                  </div>
                ) : isDraggable ? (
                  <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical className="h-4 w-4 text-white/40" />
                  </div>
                ) : null}
                {!selectMode && (
                  <Link to={`/anime/${anime.mal_id}`} className="block">
                    <div className="relative aspect-[3/4] overflow-hidden bg-gradient-to-br from-card to-black/60">
                      <img
                        src={getImageUrl(anime) || getSmallImageUrl(anime)}
                        alt={anime.title_english || anime.title}
                        loading="lazy"
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                      {/* Progress badge */}
                      {total > 0 && (
                        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-black/75 border border-white/10 text-[10px] font-mono text-white/80">
                          {watched}/{total}
                        </div>
                      )}
                      {/* Status badge (imported from AniList / MAL) */}
                      {meta && (
                        <div className={`absolute top-2 left-2 px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${STATUS_BADGE[meta.status].cls}`}>
                          {STATUS_BADGE[meta.status].label}
                        </div>
                      )}
                      {/* Score badge — top-left when no status, bottom-right when status exists (avoids progress-badge overlap) */}
                      {meta && anime.score && (
                        <div className="absolute bottom-12 right-2 px-1.5 py-0.5 rounded-md bg-yellow-500/20 border border-yellow-500/30 text-[10px] font-bold text-yellow-300 flex items-center gap-1">
                          <span>★</span>{anime.score.toFixed(1)}
                        </div>
                      )}
                      {!meta && anime.score && (
                        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-yellow-500/20 border border-yellow-500/30 text-[10px] font-bold text-yellow-300 flex items-center gap-1">
                          <span>★</span>{anime.score.toFixed(1)}
                        </div>
                      )}
                      <div className="absolute bottom-0 inset-x-0 p-3">
                        <p className="text-xs font-semibold text-white line-clamp-2 leading-snug">
                          {anime.title_english || anime.title}
                        </p>
                        {anime.title_english && (
                          <p className="text-[10px] text-white/50 line-clamp-1 mt-0.5">{anime.title}</p>
                        )}
                      </div>
                    </div>
                  </Link>
                )}
                {/* Progress bar */}
                {total > 0 && (
                  <div className="h-1 bg-white/5">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
                {/* Hover actions — hidden in select mode since selection
                    already happens via card click. */}
                {!selectMode && (
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromWatchlist(anime.mal_id) }}
                      className="h-7 w-7 rounded-md bg-black/75 border border-white/10 grid place-items-center text-red-400 hover:text-red-300 hover:bg-black/90 transition-colors"
                      title="Remove from watchlist"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {!selectMode && (
                  <Link
                    to={`/watch/${anime.mal_id}`}
                    className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  >
                    <div className="h-10 w-10 rounded-full bg-primary/90 grid place-items-center shadow-lg pointer-events-auto">
                      <Play className="h-4 w-4 text-white fill-white" />
                    </div>
                  </Link>
                )}
              </div>
              </StaggerCard>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {sortedAndFiltered.map((anime, i) => {
            const watched = getWatchedCount(anime.mal_id)
            const total = anime.episodes ?? 0
            const progress = total > 0 ? Math.round((watched / total) * 100) : 0
            const meta = getPlaylistMeta(anime.mal_id)
            const isSelected = selectedIds.has(anime.mal_id)
            return (
              <StaggerCard key={anime.mal_id} index={i}>
              <div
                onClick={selectMode ? () => toggleSelection(anime.mal_id) : undefined}
                className={`glass-card rounded-xl p-3 flex items-center gap-4 group transition-all duration-200 ${
                  selectMode
                    ? `cursor-pointer ${isSelected ? 'border-red-500/70 ring-2 ring-red-500/40 bg-red-500/[0.04]' : 'border-white/5 hover:border-white/20'}`
                    : isDraggable
                    ? `hover:border-white/15 cursor-grab active:cursor-grabbing ${dragOverIdx === i ? 'border-primary/50 shadow-[0_0_20px_-6px_hsl(245,75%,60%,0.2)]' : 'border-white/5'} ${dragActive && dragItem.current === i ? 'opacity-50' : ''}`
                    : 'border-white/5 hover:border-white/10'
                }`}
                draggable={isDraggable}
                onDragStart={(e) => {
                  if (!isDraggable) return
                  dragItem.current = i
                  setDragActive(true)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', String(i))
                }}
                onDragEnd={() => {
                  dragItem.current = null
                  dragEnterCounter.current = 0
                  setDragOverIdx(null)
                  setDragActive(false)
                }}
                onDragEnter={(e) => {
                  e.preventDefault()
                  dragEnterCounter.current++
                  setDragOverIdx(i)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                }}
                onDragLeave={() => {
                  dragEnterCounter.current--
                  if (dragEnterCounter.current <= 0) {
                    dragEnterCounter.current = 0
                    setDragOverIdx(null)
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dragEnterCounter.current = 0
                  setDragOverIdx(null)
                  const fromIndex = dragItem.current
                  if (fromIndex !== null && fromIndex !== i) {
                    reorderWatchlist(fromIndex, i)
                  }
                  dragItem.current = null
                  setDragActive(false)
                }}
              >
                {/* Row-leading control: selection checkbox in select mode,
                    drag handle in reorder mode, otherwise just leaves
                    space for the cover image on the next flex child. */}
                {selectMode ? (
                  <div className="shrink-0">
                    <div className={`h-6 w-6 rounded-md grid place-items-center border-2 transition-colors ${
                      isSelected ? 'bg-red-500 border-red-500' : 'border-white/30 bg-white/[0.04]'
                    }`}>
                      {isSelected && <CheckSquare className="h-4 w-4 text-white" />}
                    </div>
                  </div>
                ) : isDraggable ? (
                  <div className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
                    <GripVertical className="h-4 w-4 text-white/20" />
                  </div>
                ) : null}
                {!selectMode && (
                  <Link to={`/anime/${anime.mal_id}`} className="shrink-0">
                    <img
                      src={getSmallImageUrl(anime)}
                      alt={anime.title}
                      className="h-20 w-14 rounded-lg object-cover"
                      loading="lazy"
                    />
                  </Link>
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/anime/${anime.mal_id}`}
                    onClick={(e) => selectMode && e.preventDefault()}
                    className="font-semibold text-sm text-white hover:text-primary transition-colors line-clamp-1"
                  >
                    {anime.title_english || anime.title}
                  </Link>
                  {anime.title_english && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{anime.title}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded text-muted-foreground">{anime.type}</span>
                    {total > 0 && (
                      <span className="text-[10px] bg-white/5 px-2 py-0.5 rounded text-muted-foreground">
                        {watched}/{total} watched
                      </span>
                    )}
                    {anime.score && (
                      <span className="text-[10px] text-yellow-400 font-semibold flex items-center gap-1">
                        <span>★</span>{anime.score}
                      </span>
                    )}
                    {meta && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${STATUS_BADGE[meta.status].cls}`}>
                        {STATUS_BADGE[meta.status].label}
                      </span>
                    )}
                  </div>
                  {total > 0 && (
                    <div className="mt-1.5 h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
                {!selectMode && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Link
                      to={`/watch/${anime.mal_id}`}
                      className="h-9 w-9 rounded-lg bg-primary/20 flex items-center justify-center text-primary hover:bg-primary/30 transition-colors"
                      title="Watch"
                    >
                      <Play className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromWatchlist(anime.mal_id) }}
                      className="h-9 w-9 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              </StaggerCard>
            )
          })}
        </div>
      )}

      {/* Bulk-remove confirmation modal — blocks accidental large deletes.
          AniList removal happens automatically via the existing syncRemove
          callback, so we don't need a separate checkbox for it. */}
      {pendingBulkRemove && (
        <div
          className="fixed inset-0 z-[55] flex items-center justify-center px-4 bg-black/80 animate-[fadeIn_0.15s_ease]"
          onClick={() => setPendingBulkRemove(false)}
        >
          <div
            className="glass-card rounded-2xl w-full max-w-md shadow-2xl border border-red-500/20 overflow-hidden animate-[fadeInUp_0.2s_ease]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-3 flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-500/15 border border-red-500/30 grid place-items-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white">Remove from your list?</h2>
                <p className="text-[12px] text-muted-foreground mt-1 leading-snug">
                  You&rsquo;re about to remove <span className="font-bold text-white tabular-nums">{selectedIds.size}</span>{' '}
                  {selectedIds.size === 1 ? 'anime' : 'anime'} from your watchlist. Your watched-episode history will also be cleared for those entries.
                  {auth && ' If you&rsquo;re signed in to AniList, they&rsquo;ll be removed from your AniList library too.'}
                </p>
              </div>
            </div>
            <div className="px-5 pb-4">
              <ul className="max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-black/30 text-xs divide-y divide-white/5">
                {[...selectedIds].slice(0, 6).map((id) => {
                  const a = watchlist.find((w) => w.mal_id === id)
                  if (!a) return null
                  return (
                    <li key={id} className="flex items-center gap-2 px-3 py-1.5">
                      <Trash2 className="h-3 w-3 text-red-400 shrink-0" />
                      <span className="text-white/80 truncate">{a.title_english || a.title}</span>
                    </li>
                  )
                })}
                {selectedIds.size > 6 && (
                  <li className="px-3 py-1.5 text-[10px] text-muted-foreground">
                    + {selectedIds.size - 6} more
                  </li>
                )}
              </ul>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/5 bg-black/30">
              <button
                onClick={() => setPendingBulkRemove(false)}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white/70 bg-white/[0.04] hover:bg-white/[0.08] hover:text-white border border-white/8 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={performBulkRemove}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-[0_4px_16px_-6px_rgba(239,68,68,0.5)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
