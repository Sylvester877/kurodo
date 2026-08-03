import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  X, Upload, Cloud, FileJson, CheckCircle2, AlertCircle, Loader2,
  Star, ChevronDown, ChevronUp, Search, User,
} from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'
import { useWatchListStore, type PlaylistStatus, type PlaylistMeta } from '../store/useWatchListStore'
import { toast } from './Toaster'
import {
  getAniListPlaylistSummary,
  getAniListUsernameSummary,
  getMalUsernameSummary,
  type AniListPlaylistSummary,
  type AniListUsernameSummary,
} from '../lib/sync'
import { summarizeMalXml, malStatusToPlaylist, type MalXmlEntry } from '../lib/malXml'
import { getAnimeById } from '../api/anime'
import type { Anime } from '../types'
import { cn } from '../lib/utils'

interface Props {
  open: boolean
  onClose: () => void
}

type Source = 'anilist' | 'mal'
type Phase = 'pick' | 'preview' | 'importing' | 'done'

// Human-friendly labels + colours for each status (used in toggles + badges)
const STATUS_META: Record<PlaylistStatus, { label: string; tone: string; dot: string }> = {
  CURRENT:        { label: 'Watching',         tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  WATCHING:       { label: 'Watching',         tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  PLANNING:       { label: 'Plan to Watch',    tone: 'text-sky-300 bg-sky-500/10 border-sky-500/30',           dot: 'bg-sky-400' },
  PLAN_TO_WATCH:  { label: 'Plan to Watch',    tone: 'text-sky-300 bg-sky-500/10 border-sky-500/30',           dot: 'bg-sky-400' },
  COMPLETED:      { label: 'Completed',        tone: 'text-violet-300 bg-violet-500/10 border-violet-500/30',   dot: 'bg-violet-400' },
  PAUSED:         { label: 'Paused',           tone: 'text-amber-300 bg-amber-500/10 border-amber-500/30',     dot: 'bg-amber-400' },
  ON_HOLD:        { label: 'On Hold',          tone: 'text-amber-300 bg-amber-500/10 border-amber-500/30',     dot: 'bg-amber-400' },
  DROPPED:        { label: 'Dropped',          tone: 'text-rose-300 bg-rose-500/10 border-rose-500/30',         dot: 'bg-rose-400' },
  REPEATING:      { label: 'Rewatching',       tone: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30',         dot: 'bg-cyan-400' },
}

/** A status is "importable" if it represents an anime the user actually
 *  cares about (anything except 'dropped' and 'on hold', which they may
 *  not want to import). */
const DEFAULT_ENABLED: Record<PlaylistStatus, boolean> = {
  CURRENT: true, PLANNING: true, COMPLETED: true, REPEATING: true,
  WATCHING: true, PLAN_TO_WATCH: true,
  DROPPED: false, PAUSED: false, ON_HOLD: false,
}

export default function ImportPlaylistDialog({ open, onClose }: Props) {
  const auth = useAuthStore((s) => s.auth)
  const addToWatchlist = useWatchListStore((s) => s.addToWatchlist)
  const setPlaylistMetaBatch = useWatchListStore((s) => s.setPlaylistMetaBatch)
  const isInWatchlist = useWatchListStore((s) => s.isInWatchlist)

  const [source, setSource] = useState<Source>('anilist')
  const [phase, setPhase] = useState<Phase>('pick')
  const [anilist, setAnilist] = useState<AniListPlaylistSummary | AniListUsernameSummary | null>(null)
  const [mal, setMal] = useState<{ entries: MalXmlEntry[]; counts: Record<PlaylistStatus, number>; total: number } | null>(null)
  const [anilistLoading, setAnilistLoading] = useState(false)
  const [malUsernameLoading, setMalUsernameLoading] = useState(false)
  const [enabled, setEnabled] = useState<Record<PlaylistStatus, boolean>>(DEFAULT_ENABLED)
  const [progress, setProgress] = useState({ done: 0, total: 0, added: 0, skipped: 0, failed: 0 })
  const [previewOpen, setPreviewOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [anilistUsername, setAnilistUsername] = useState('')
  const [malUsername, setMalUsername] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setPhase('pick')
      setAnilist(null)
      setMal(null)
      setEnabled(DEFAULT_ENABLED)
      setError(null)
      setProgress({ done: 0, total: 0, added: 0, skipped: 0, failed: 0 })
      setPreviewOpen(false)
      setAnilistUsername('')
      setMalUsername('')
      cancelRef.current = false
    }
  }, [open])

  // Auto-fetch AniList when user picks that source (signed-in only)
  useEffect(() => {
    if (!open || phase !== 'pick' || source !== 'anilist' || anilist || anilistLoading) return
    if (!auth) return // Don't auto-fetch — user can type a username instead
    setError(null)
    setAnilistLoading(true)
    getAniListPlaylistSummary()
      .then((summary) => {
        if (!summary) {
          setError('Could not load your AniList list — token may be expired.')
          return
        }
        setAnilist(summary)
        setPhase('preview')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load AniList list'))
      .finally(() => setAnilistLoading(false))
  }, [open, phase, source, anilist, anilistLoading, auth])

  // AniList username lookup
  const onAniListUsernameLookup = useCallback(async () => {
    const name = anilistUsername.trim()
    if (!name) return
    setError(null)
    setAnilistLoading(true)
    try {
      const summary = await getAniListUsernameSummary(name)
      if (summary.total === 0) {
        setError(`No anime found in ${name}'s AniList library. They may not have added any anime yet.`)
        return
      }
      setAnilist(summary)
      setPhase('preview')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load AniList list'
      const lower = msg.toLowerCase()
      if (lower.includes('private')) {
        setError(`${name}'s AniList profile is private.`)
      } else if (lower.includes('not found') || lower.includes('not exist')) {
        setError(`AniList user "${name}" not found. Check the spelling or make sure the profile is public.`)
      } else {
        setError(msg)
      }
    } finally {
      setAnilistLoading(false)
    }
  }, [anilistUsername])

  // MAL username lookup
  const onMalUsernameLookup = useCallback(async () => {
    const name = malUsername.trim()
    if (!name) return
    setError(null)
    setMalUsernameLoading(true)
    try {
      const summary = await getMalUsernameSummary(name)
      if (summary.total === 0) {
        setError(`No anime found in ${name}'s MAL list.`)
        return
      }
      setMal(summary)
      setPhase('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load MAL list')
    } finally {
      setMalUsernameLoading(false)
    }
  }, [malUsername])

  // MAL file handling
  const onMalFile = useCallback(async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      const summary = summarizeMalXml(text)
      if (summary.total === 0) {
        setError('No <anime> entries found in this XML file.')
        return
      }
      setMal(summary)
      setPhase('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse MAL XML')
    }
  }, [])

  // Counts the user is about to import (filter by enabled statuses)
  const previewEntries = useMemo(() => {
    if (source === 'anilist' && anilist) {
      return anilist.entries
        .filter((e: any) => enabled[e.status as PlaylistStatus])
        .map((e: any) => ({
          malId: e.media.idMal ?? 0,
          title: e.media.title.english || e.media.title.romaji || `MAL #${e.media.idMal ?? '?'}`,
          status: e.status as PlaylistStatus,
          score: e.score,
          watchedEpisodes: e.progress,
          episodes: e.media.episodes,
        }))
    }
    if (source === 'mal' && mal) {
      return mal.entries
        .filter((e) => enabled[malStatusToPlaylist(e.status)])
        .map((e) => ({
          malId: e.malId,
          title: e.title,
          status: malStatusToPlaylist(e.status),
          score: e.score,
          watchedEpisodes: e.watchedEpisodes,
          episodes: e.episodes,
        }))
    }
    return []
  }, [source, anilist, mal, enabled])

  const totalToImport = previewEntries.length

  const toggleStatus = (s: PlaylistStatus) => {
    setEnabled((cur) => ({ ...cur, [s]: !cur[s] }))
  }

  const startImport = async () => {
    if (totalToImport === 0) {
      toast.info('No entries match the selected statuses')
      return
    }
    setPhase('importing')
    setProgress({ done: 0, total: totalToImport, added: 0, skipped: 0, failed: 0 })

    const metaBatch: Array<{ malId: number; meta: PlaylistMeta }> = []
    const watchedEpisodesBatch: Array<{ malId: number; ep: number }> = []
    let totalAdded = 0, totalSkipped = 0, totalFailed = 0
    // Concurrency limiter: process entries 2-at-a-time to avoid
    // hammering Jikan with 3+ concurrent MAL lookups per batch.
    // Large imports (500+ entries) would otherwise hit rate limits
    // and cause half the import to silently fail.
    const BATCH = 2
    for (let i = 0; i < previewEntries.length; i += BATCH) {
      if (cancelRef.current) break
      const chunk = previewEntries.slice(i, i + BATCH)
      // Per-chunk counters — capture into consts before setProgress so
      // React's deferred updater sees the right values, not whatever the
      // shared counter holds when it eventually runs.
      let chunkAdded = 0, chunkSkipped = 0, chunkFailed = 0
      await Promise.all(chunk.map(async (entry) => {
        if (!entry.malId) { chunkFailed++; return }
        try {
          if (isInWatchlist(entry.malId)) {
            chunkSkipped++
            // Still record meta so the status/score is preserved
            metaBatch.push({
              malId: entry.malId,
              meta: {
                status: entry.status,
                score: entry.score,
                watchedEpisodes: entry.watchedEpisodes,
                source: source,
                importedAt: Date.now(),
              },
            })
            return
          }
          // Fetch full anime metadata (MAL/Jikan), fall back to a stub
          let anime: Anime | null = null
          try {
            const r = await getAnimeById(entry.malId)
            if (r?.data) anime = r.data
          } catch { /* fall through */ }
          if (!anime) {
            anime = makeStubAnime(entry)
          }
          addToWatchlist(anime)
          metaBatch.push({
            malId: entry.malId,
            meta: {
              status: entry.status,
              score: entry.score,
              watchedEpisodes: entry.watchedEpisodes,
              source: source,
              importedAt: Date.now(),
            },
          })
          // Schedule episode-progress application
          for (let ep = 1; ep <= Math.min(entry.watchedEpisodes, entry.episodes ?? 9999); ep++) {
            watchedEpisodesBatch.push({ malId: entry.malId, ep })
          }
          chunkAdded++
        } catch {
          chunkFailed++
        }
      }))
      totalAdded += chunkAdded
      totalSkipped += chunkSkipped
      totalFailed += chunkFailed
      setProgress({
        done: Math.min(i + BATCH, previewEntries.length),
        total: previewEntries.length,
        added: totalAdded,
        skipped: totalSkipped,
        failed: totalFailed,
      })
      if (i + BATCH < previewEntries.length) {
        await new Promise((r) => setTimeout(r, 200))
      }
    }

    // Apply meta + watched-episode batches
    if (metaBatch.length > 0) setPlaylistMetaBatch(metaBatch)
    // Batched watched-episode write — goes through setState directly to
    // avoid firing the per-episode toast from markEpisodeWatched.
    const watched = useWatchListStore.getState().watchedEpisodes
    const next = { ...watched }
    for (const { malId, ep } of watchedEpisodesBatch) {
      const arr = next[malId] || []
      if (!arr.includes(ep)) arr.push(ep)
      next[malId] = arr.sort((a, b) => a - b)
    }
    useWatchListStore.setState({ watchedEpisodes: next })

    setPhase('done')
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[55] flex items-start sm:items-center justify-center px-4 py-6 bg-black/75 animate-[fadeIn_0.15s_ease]"
      onClick={onClose}
    >
      <div
        className="glass-card rounded-2xl w-full max-w-2xl shadow-2xl border border-white/10 overflow-hidden animate-[fadeInUp_0.2s_ease]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-white/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center shrink-0">
              <Upload className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white">Import playlist</h2>
              <p className="text-[11px] text-muted-foreground">
                Bring in your anime list from AniList or MyAnimeList
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-white transition-colors p-1"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Source tabs (only in pick phase) */}
        {phase === 'pick' && (
          <div className="px-5 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setSource('anilist')}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-xl border text-left transition-all',
                  source === 'anilist'
                    ? 'bg-emerald-500/10 border-emerald-500/40 ring-1 ring-emerald-500/30'
                    : 'bg-white/[0.03] border-white/10 hover:border-white/20',
                )}
              >
                <div className="h-10 w-10 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
                  <Cloud className="h-5 w-5 text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">AniList</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Your account · or type any username
                  </p>
                </div>
              </button>
              <button
                onClick={() => setSource('mal')}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-xl border text-left transition-all',
                  source === 'mal'
                    ? 'bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/30'
                    : 'bg-white/[0.03] border-white/10 hover:border-white/20',
                )}
              >
                <div className="h-10 w-10 rounded-lg bg-blue-500/15 grid place-items-center shrink-0">
                  <FileJson className="h-5 w-5 text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white">MyAnimeList</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                    Type a username · or upload XML
                  </p>
                </div>
              </button>
            </div>

            <div className="mt-5 min-h-[200px]">
              {source === 'anilist' ? (
                <AniListPicker
                  loading={anilistLoading}
                  error={error}
                  authed={!!auth}
                  username={anilistUsername}
                  onUsernameChange={setAnilistUsername}
                  onUsernameLookup={onAniListUsernameLookup}
                />
              ) : (
                <MalPicker
                  onFile={onMalFile}
                  error={error}
                  fileRef={fileRef}
                  username={malUsername}
                  onUsernameChange={setMalUsername}
                  onUsernameLookup={onMalUsernameLookup}
                  loading={malUsernameLoading}
                />
              )}
            </div>
          </div>
        )}

        {/* Preview phase: status breakdown + entry list */}
        {phase === 'preview' && (
          <PreviewPanel
            source={source}
            anilist={anilist}
            mal={mal}
            enabled={enabled}
            onToggle={toggleStatus}
            previewCount={totalToImport}
            previewOpen={previewOpen}
            onTogglePreview={() => setPreviewOpen((o) => !o)}
            previewEntries={previewEntries}
            onBack={() => { setPhase('pick'); setMal(null); setAnilist(null) }}
            onStart={startImport}
          />
        )}

        {/* Importing phase: progress bar + cancel */}
        {phase === 'importing' && (
          <div className="px-5 py-8">
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
              <div>
                <p className="text-sm font-semibold text-white">
                  Importing {progress.done}/{progress.total}…
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Fetching metadata from MAL and adding to your list
                </p>
              </div>
            </div>
            <div className="h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-200"
                style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              {progress.added} added · {progress.skipped} already in list · {progress.failed} skipped
            </p>
          </div>
        )}

        {/* Done phase: summary */}
        {phase === 'done' && (
          <div className="px-5 py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
            <p className="text-lg font-bold text-white mb-1">Import complete!</p>
            <p className="text-sm text-muted-foreground mb-5">
              {progress.added} added · {progress.skipped} already in list · {progress.failed} failed
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function AniListPicker({
  loading, error, authed, username, onUsernameChange, onUsernameLookup,
}: {
  loading: boolean
  error: string | null
  authed: boolean
  username: string
  onUsernameChange: (v: string) => void
  onUsernameLookup: () => void
}) {
  const [mode, setMode] = useState<'account' | 'username'>(authed ? 'account' : 'username')

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-10">
        <Loader2 className="h-5 w-5 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Loading AniList library…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle — only show both options when signed in */}
      {authed && (
        <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/5">
          <button
            onClick={() => setMode('account')}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all',
              mode === 'account'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-white/40 hover:text-white/60',
            )}
          >
            My account
          </button>
          <button
            onClick={() => setMode('username')}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all',
              mode === 'username'
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-white/40 hover:text-white/60',
            )}
          >
            By username
          </button>
        </div>
      )}

      {mode === 'account' && authed ? (
        <p className="text-xs text-muted-foreground py-2">
          Picking this source automatically loads your AniList library — pick which categories to import on the next step.
        </p>
      ) : (
        <div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Enter any public AniList username to import their list. No sign-in needed.
          </p>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                type="text"
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onUsernameLookup() }}
                placeholder="AniList username…"
                className="w-full h-10 pl-9 pr-3 rounded-lg bg-white/[0.04] border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/30 transition-colors"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              onClick={onUsernameLookup}
              disabled={!username.trim()}
              className={cn(
                'px-4 h-10 rounded-lg text-sm font-semibold transition-all inline-flex items-center gap-1.5',
                username.trim()
                  ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                  : 'bg-white/5 text-white/25 cursor-not-allowed',
              )}
            >
              <Search className="h-3.5 w-3.5" />
              Load
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-300">Couldn't load list</p>
            <p className="text-[11px] text-red-200/70 mt-1">{error}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function MalPicker({
  onFile, error, fileRef, username, onUsernameChange, onUsernameLookup, loading,
}: {
  onFile: (f: File) => void
  error: string | null
  fileRef: React.RefObject<HTMLInputElement | null>
  username: string
  onUsernameChange: (v: string) => void
  onUsernameLookup: () => void
  loading: boolean
}) {
  const [mode, setMode] = useState<'username' | 'xml'>('username')

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.04] border border-white/5">
        <button
          onClick={() => setMode('username')}
          className={cn(
            'flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all',
            mode === 'username'
              ? 'bg-blue-500/20 text-blue-300'
              : 'text-white/40 hover:text-white/60',
          )}
        >
          By username
        </button>
        <button
          onClick={() => setMode('xml')}
          className={cn(
            'flex-1 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all',
            mode === 'xml'
              ? 'bg-blue-500/20 text-blue-300'
              : 'text-white/40 hover:text-white/60',
          )}
        >
          XML upload
        </button>
      </div>

      {mode === 'username' ? (
        <div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Enter any MyAnimeList username to import their list. No sign-in needed.
          </p>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Loading MAL list…</p>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => onUsernameChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onUsernameLookup() }}
                  placeholder="MAL username…"
                  className="w-full h-10 pl-9 pr-3 rounded-lg bg-white/[0.04] border border-white/10 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/30 transition-colors"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <button
                onClick={onUsernameLookup}
                disabled={!username.trim()}
                className={cn(
                  'px-4 h-10 rounded-lg text-sm font-semibold transition-all inline-flex items-center gap-1.5',
                  username.trim()
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-white/5 text-white/25 cursor-not-allowed',
                )}
              >
                <Search className="h-3.5 w-3.5" />
                Load
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            Export your list from{' '}
            <a
              href="https://myanimelist.net/panel.php?go=export"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              myanimelist.net/panel.php?go=export
            </a>{' '}
            — you'll get a <code className="text-white/70">.xml</code> file. Drop it here.
          </p>
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-xl border-2 border-dashed border-white/15 hover:border-blue-500/40 hover:bg-blue-500/5 transition-colors p-6 text-center"
          >
            <Upload className="h-6 w-6 text-blue-400 mx-auto mb-2" />
            <p className="text-sm font-semibold text-white">Choose MAL XML file</p>
            <p className="text-[11px] text-muted-foreground mt-1">.xml up to a few MB</p>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,application/xml,text/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-200/80">{error}</p>
        </div>
      )}
    </div>
  )
}

function PreviewPanel({
  source, anilist, mal, enabled, onToggle, previewCount, previewOpen, onTogglePreview, previewEntries, onBack, onStart,
}: {
  source: Source
  anilist: AniListPlaylistSummary | AniListUsernameSummary | null
  mal: { entries: MalXmlEntry[]; counts: Record<PlaylistStatus, number>; total: number } | null
  enabled: Record<PlaylistStatus, boolean>
  onToggle: (s: PlaylistStatus) => void
  previewCount: number
  previewOpen: boolean
  onTogglePreview: () => void
  previewEntries: Array<{ malId: number; title: string; status: PlaylistStatus; score: number; watchedEpisodes: number; episodes: number | null }>
  onBack: () => void
  onStart: () => void
}) {
  const emptyCounts: Record<PlaylistStatus, number> = {
    CURRENT: 0, PLANNING: 0, COMPLETED: 0, DROPPED: 0, PAUSED: 0, REPEATING: 0,
    WATCHING: 0, ON_HOLD: 0, PLAN_TO_WATCH: 0,
  }
  const counts: Record<PlaylistStatus, number> = source === 'anilist' && anilist
    ? { ...emptyCounts, ...anilist.counts as Partial<Record<PlaylistStatus, number>> }
    : mal?.counts ?? emptyCounts
  const total = source === 'anilist' ? anilist?.total ?? 0 : mal?.total ?? 0

  // Order statuses for display
  const statusOrder: PlaylistStatus[] = source === 'anilist'
    ? ['CURRENT', 'PLANNING', 'COMPLETED', 'REPEATING', 'PAUSED', 'DROPPED']
    : ['WATCHING', 'PLAN_TO_WATCH', 'COMPLETED', 'ON_HOLD', 'DROPPED']

  // Determine source label
  const sourceLabel = source === 'anilist' ? 'AniList' : 'MAL'
  const SourceIcon = source === 'anilist' ? Cloud : FileJson

  return (
    <div className="px-5 pt-4 pb-5">
      {/* Source badge */}
      <div className="flex items-center gap-2 mb-3">
        <span className={cn(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
          source === 'anilist'
            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
            : 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
        )}>
          <SourceIcon className="h-3 w-3" />
          {sourceLabel}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {total} entries found
        </span>
      </div>

      {/* Status checkboxes */}
      <div className="space-y-2 mb-4">
        {statusOrder.map((s) => {
          const count = counts[s] || 0
          if (count === 0) return null
          const meta = STATUS_META[s]
          const isOn = enabled[s]
          return (
            <button
              key={s}
              onClick={() => onToggle(s)}
              className={cn(
                'w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left',
                isOn
                  ? 'bg-white/[0.04] border-white/15'
                  : 'bg-transparent border-white/5 opacity-50',
              )}
            >
              <div className={cn(
                'h-4 w-4 rounded border-2 grid place-items-center transition-colors shrink-0',
                isOn ? 'bg-primary border-primary' : 'border-white/20',
              )}>
                {isOn && <CheckCircle2 className="h-3 w-3 text-white" />}
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className={cn('h-2 w-2 rounded-full shrink-0', meta.dot)} />
                <span className="text-sm font-semibold text-white">{meta.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{count}</span>
              </div>
            </button>
          )
        })}
      </div>

      {/* Preview list toggle */}
      <button
        onClick={onTogglePreview}
        className="flex items-center gap-1.5 text-[11px] text-white/60 hover:text-white transition-colors mb-2"
      >
        {previewOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {previewOpen ? 'Hide' : 'Show'} {previewCount} titles to import
      </button>
      {previewOpen && (
        <div data-lenis-prevent className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-black/30 mb-4">
          {previewEntries.slice(0, 100).map((e) => (
            <div key={e.malId} className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 last:border-b-0 text-xs">
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATUS_META[e.status].dot)} />
              <span className="flex-1 truncate text-white/80">{e.title}</span>
              {e.score > 0 && (
                <span className="text-yellow-400 flex items-center gap-0.5 shrink-0">
                  <Star className="h-2.5 w-2.5 fill-current" />
                  {e.score}
                </span>
              )}
              {e.watchedEpisodes > 0 && (
                <span className="text-muted-foreground font-mono shrink-0">
                  {e.watchedEpisodes}/{e.episodes ?? '?'}
                </span>
              )}
            </div>
          ))}
          {previewEntries.length > 100 && (
            <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
              + {previewEntries.length - 100} more
            </p>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-2 border-t border-white/5">
        <button
          onClick={onBack}
          className="px-3 py-2 rounded-lg text-xs font-semibold text-white/60 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
        >
          Back
        </button>
        <div className="flex-1" />
        <button
          onClick={onStart}
          disabled={previewCount === 0}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold transition-all',
            previewCount > 0
              ? 'bg-primary text-white hover:bg-primary/90 shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.55)]'
              : 'bg-white/5 text-white/30 cursor-not-allowed',
          )}
        >
          <Upload className="h-3.5 w-3.5" />
          Import {previewCount} {previewCount === 1 ? 'anime' : 'anime'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function makeStubAnime(entry: { malId: number; title: string; episodes: number | null; score: number }): Anime {
  return {
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
    type: 'TV',
    status: '', episodes: entry.episodes,
    duration: null, rating: null,
    aired: { from: null, to: null, string: null },
    season: null, year: null,
    genres: [], studios: [], themes: [], demographics: [],
  } as Anime
}
