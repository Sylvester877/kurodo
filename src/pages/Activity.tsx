import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Send, History, EyeOff, Heart, MessageSquare, ExternalLink, Trash2,
  Loader2, Sparkles, ChevronLeft, ChevronRight, RotateCcw,
  AlertCircle, LogIn, Search, X,
} from 'lucide-react'
import { useTitle } from '../hooks/useTitle'
import { useAuthStore } from '../store/useAuthStore'
import { useWatchListStore } from '../store/useWatchListStore'
import {
  fetchMyActivity, deleteActivityById, type MyTextActivity,
} from '../api/anilistAuth'
import {
  subscribePendingActivity, getPendingActivity, flushAllActivity,
  getOptedOutMalIds, setActivityOptedOut, type PendingActivityEntry,
} from '../lib/sync'
import { cn, getSmallImageUrl } from '../lib/utils'
import { Skeleton } from '../components/Skeleton'
import { toast } from '../components/Toaster'

type Tab = 'history' | 'pending' | 'muted'

/**
 * /activity — full activity dashboard.
 *
 * Three tabs:
 *   • History — recent text-activity posts read back from AniList
 *   • Pending — what's in the local buffer waiting to flush
 *   • Muted   — per-show opt-outs with one-click re-enable
 *
 * Gated on sign-in: shows a friendly "sign in to see this" screen
 * otherwise so we don't crash or spam errors.
 */
export default function Activity() {
  useTitle('Activity')
  const auth = useAuthStore((s) => s.auth)
  const [tab, setTab] = useState<Tab>('history')

  if (!auth) {
    return (
      <div className="pt-20 pb-12 px-4 max-w-md mx-auto text-center">
        <div className="glass-card rounded-2xl p-8">
          <div className="h-12 w-12 rounded-xl bg-primary/15 grid place-items-center mx-auto mb-3">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-white mb-1">
            Sign in to see your activity
          </h1>
          <p className="text-sm text-white/55 mb-5">
            Your post history, pending queue, and per-show opt-outs all
            live here — once you're signed in to AniList.
          </p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 bg-primary text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90"
          >
            <LogIn className="h-4 w-4" />
            Open Settings to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-20 pb-16">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="glass-card rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center">
              <Send className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white leading-tight">
                Activity dashboard
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage what you've posted, what's queued, and which shows you've muted.
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06] w-full sm:w-fit">
          <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>
            <History className="h-3.5 w-3.5" /> History
          </TabBtn>
          <TabBtn active={tab === 'pending'} onClick={() => setTab('pending')}>
            <Send className="h-3.5 w-3.5" /> Pending
          </TabBtn>
          <TabBtn active={tab === 'muted'} onClick={() => setTab('muted')}>
            <EyeOff className="h-3.5 w-3.5" /> Muted
          </TabBtn>
        </div>

        {tab === 'history' && <HistoryTab />}
        {tab === 'pending' && <PendingTab />}
        {tab === 'muted' && <MutedTab />}
      </div>
    </div>
  )
}

function TabBtn({
  children, active, onClick,
}: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all',
        active
          ? 'bg-primary text-white shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.5)]'
          : 'text-white/55 hover:text-white hover:bg-white/5',
      )}
    >
      {children}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────
// HISTORY TAB — recent posts read back from AniList
// ──────────────────────────────────────────────────────────────────

function HistoryTab() {
  const token = useAuthStore((s) => s.auth?.token)
  const userId = useAuthStore((s) => s.auth?.user.id)
  const [page, setPage] = useState(1)
  const qc = useQueryClient()

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['my-activity', userId, page],
    queryFn: () => fetchMyActivity(token!, userId!, page),
    enabled: !!token && !!userId,
    staleTime: 60 * 1000,
  })

  const delMut = useMutation({
    mutationFn: async (id: number) => deleteActivityById(token!, id),
    onSuccess: (deleted, id) => {
      if (!deleted) {
        toast.error("AniList didn't acknowledge the delete — try again later")
        return
      }
      // Optimistic local removal so the row vanishes instantly.
      qc.setQueryData(
        ['my-activity', userId, page],
        (old: { items: MyTextActivity[]; hasNextPage: boolean } | undefined) =>
          old ? { ...old, items: old.items.filter((a) => a.id !== id) } : old,
      )
      toast.success('Activity deleted from AniList')
    },
    onError: () => toast.error('Could not delete — token may be expired'),
  })

  if (error) {
    return (
      <ErrorCard
        title="Couldn't load activity"
        message="Your AniList token may be expired. Re-sign-in from the navbar and try again."
      />
    )
  }

  return (
    <div className="space-y-0">
      {isLoading && (
        <>
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </>
      )}

      {!isLoading && data && data.items.length === 0 && (
        <EmptyCard
          icon={<Send className="h-6 w-6 text-primary" />}
          title="No posts yet"
          message="Watch an episode → 60s later, it'll show up here. Or change the auto-flush window in Settings → AniList activity."
          cta={{ label: 'Open Settings', to: '/settings' }}
        />
      )}

      {/* Timeline container with vertical connector */}
      <div className="relative">
        {/* Vertical timeline line */}
        <div
          aria-hidden
          className="absolute left-[20px] top-3 bottom-3 w-px bg-gradient-to-b from-white/[0.08] via-white/[0.04] to-transparent"
        />
        <div className="space-y-4">
          {data?.items.map((a) => (
            <ActivityCard
              key={a.id}
              activity={a}
              onDelete={() => delMut.mutate(a.id)}
              deleting={delMut.isPending && delMut.variables === a.id}
            />
          ))}
        </div>
      </div>

      {/* Pagination */}
      {data && (data.hasNextPage || page > 1) && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-white/80 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </button>
          <span className="text-xs font-mono text-muted-foreground">
            Page {page}
            {isFetching && <Loader2 className="inline ml-2 h-3 w-3 animate-spin text-primary" />}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!data.hasNextPage}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-white/80 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/10"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

function ActivityCard({
  activity, onDelete, deleting,
}: {
  activity: MyTextActivity
  onDelete: () => void
  deleting: boolean
}) {
  const date = new Date(activity.createdAt * 1000)
  const rel = formatRelative(activity.createdAt)
  // Determine activity type from text content for color coding
  const isFinished = activity.text.includes('Finished') || activity.text.includes('Completed')
  const isBinge = activity.text.includes('–') && activity.text.match(/\d+/) != null
  return (
    <article className="relative pl-10 group">
      {/* Timeline dot */}
      <div
        className="absolute left-[14px] top-5 h-3 w-3 rounded-full border-2 z-10 ring-4 ring-black"
        style={{
          backgroundColor: isFinished ? 'hsl(152 76% 44%)' : isBinge ? 'hsl(245 75% 60%)' : 'hsl(0 0% 20%)',
          borderColor: isFinished ? 'hsl(152 76% 44%)' : isBinge ? 'hsl(245 75% 60%)' : 'hsl(0 0% 30%)',
        }}
      />
      {/* Card */}
      <div className="glass-card rounded-xl p-4">
        <header className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className={cn(
              'glass-pill text-[10px]',
              isFinished
                ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/15'
                : isBinge
                  ? 'text-primary border-primary/30 bg-primary/15'
                  : '',
            )}>
              {isFinished ? 'Completed' : isBinge ? 'Watching' : 'Activity'}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">{rel}</span>
            <span className="text-[10px] text-white/25">
              {date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {activity.siteUrl && (
              <a
                href={activity.siteUrl}
                target="_blank" rel="noreferrer"
                className="p-1.5 rounded-md text-white/40 hover:text-primary hover:bg-white/5 transition-colors"
                title="Open on AniList"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button
              onClick={() => {
                if (confirm('Delete this activity from AniList? This cannot be undone.')) onDelete()
              }}
              disabled={deleting}
              aria-label="Delete activity"
              className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md text-white/40 hover:text-red-300 hover:bg-red-500/10 transition-all disabled:opacity-40"
              title="Delete on AniList"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </header>

        <div className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap">
          {renderSimpleMarkdown(activity.text)}
        </div>

        <footer className="mt-3 pt-3 border-t border-white/[0.04] flex items-center gap-4 text-xs text-muted-foreground">
          <span className={cn('inline-flex items-center gap-1', activity.likeCount > 0 && 'text-red-300')}>
            <Heart className={cn('h-3.5 w-3.5', activity.isLiked && 'fill-red-300')} />
            <span className="tabular-nums">{activity.likeCount}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="tabular-nums">{activity.replyCount}</span>
          </span>
        </footer>
      </div>
    </article>
  )
}

/**
 * Tiny markdown subset just for what our app posts.
 *   **bold**          → <strong>
 *   ~~~small~~~       → <small>
 *   [text](url)       → <a>
 * Plain text falls through.
 */
function renderSimpleMarkdown(text: string): React.ReactNode {
  // Process small first so the link parser sees the inner [text](url)
  const small = text.split(/(~~~[^~]+~~~)/g)
  return small.map((chunk, i) => {
    const smallMatch = chunk.match(/^~~~([^~]+)~~~$/)
    if (smallMatch) {
      return (
        <small key={i} className="block text-[11px] text-white/45 mt-1.5 italic">
          {renderInline(smallMatch[1])}
        </small>
      )
    }
    return <span key={i}>{renderInline(chunk)}</span>
  })
}

function renderInline(text: string): React.ReactNode {
  // bold then links — process bold first since urls don't contain **
  const parts: React.ReactNode[] = []
  const splitBold = text.split(/(\*\*[^*]+\*\*)/g)
  let key = 0
  for (const piece of splitBold) {
    const b = piece.match(/^\*\*(.+)\*\*$/)
    if (b) {
      parts.push(<strong key={key++}>{linkify(b[1], key)}</strong>)
    } else {
      parts.push(<span key={key++}>{linkify(piece, key)}</span>)
    }
  }
  return parts
}

function linkify(text: string, baseKey: number): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /\[([^\]]+)\]\(([^)]+)\)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<span key={`${baseKey}-${i++}`}>{text.slice(last, m.index)}</span>)
    parts.push(
      <a
        key={`${baseKey}-${i++}`}
        href={m[2]}
        target="_blank" rel="noreferrer"
        className="text-primary hover:underline"
      >
        {m[1]}
      </a>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={`${baseKey}-${i++}`}>{text.slice(last)}</span>)
  return parts
}

// Relative-time formatter ("2m ago", "3h ago", "yesterday")
function formatRelative(unixSeconds: number): string {
  const diff = Math.floor((Date.now() - unixSeconds * 1000) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 2) return 'yesterday'
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`
  return `${Math.floor(diff / (86400 * 365))}y ago`
}

// ──────────────────────────────────────────────────────────────────
// PENDING TAB — local buffer
// ──────────────────────────────────────────────────────────────────

function PendingTab() {
  const [entries, setEntries] = useState<PendingActivityEntry[]>([])
  const watchlist = useWatchListStore((s) => s.watchlist)
  const continueWatching = useWatchListStore((s) => s.continueWatching)

  useEffect(() => {
    const update = () => setEntries(getPendingActivity())
    update()
    const unsub = subscribePendingActivity(update)
    const tick = window.setInterval(update, 1000)
    return () => { unsub(); window.clearInterval(tick) }
  }, [])

  const titleFor = (malId: number) => {
    const a =
      watchlist.find((x) => x.mal_id === malId) ??
      continueWatching.find((c) => c.anime.mal_id === malId)?.anime
    return a?.title_english || a?.title || `MAL #${malId}`
  }
  const animeFor = (malId: number) =>
    watchlist.find((x) => x.mal_id === malId) ??
    continueWatching.find((c) => c.anime.mal_id === malId)?.anime ??
    null

  if (entries.length === 0) {
    return (
      <EmptyCard
        icon={<Send className="h-6 w-6 text-primary" />}
        title="Nothing queued"
        message="Watch episodes and they'll appear here, batched until the auto-flush timer expires."
      />
    )
  }

  const totalEpisodes = entries.reduce((s, e) => s + e.episodes.length, 0)

  return (
    <div className="space-y-3">
      <div className="glass-card rounded-xl p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/15 grid place-items-center shrink-0">
          <Send className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">
            {entries.length} {entries.length === 1 ? 'show' : 'shows'} ·{' '}
            {totalEpisodes} episodes queued
          </p>
          <p className="text-[11px] text-muted-foreground">
            Auto-posts when each show goes idle.
          </p>
        </div>
        <button
          onClick={() => {
            flushAllActivity()
            toast.info('Flushing pending activity now…', 2500)
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90"
        >
          <Send className="h-3 w-3" />
          Post all now
        </button>
      </div>

      {entries.map((e) => {
        const anime = animeFor(e.malId)
        const secs = Math.ceil(e.flushesInMs / 1000)
        return (
          <div key={e.malId} className="glass-card rounded-xl p-4 flex items-center gap-3 group">
            {anime ? (
              <img
                src={getSmallImageUrl(anime)}
                alt=""
                className="h-14 w-10 rounded object-cover shrink-0 border border-white/10"
              />
            ) : (
              <div className="h-14 w-10 rounded shimmer shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{titleFor(e.malId)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                <span className="font-mono text-accent">
                  {formatEpisodeList(e.episodes)}
                </span>
                <span className="text-white/30 mx-1.5">·</span>
                <span className="tabular-nums">posts in {secs}s</span>
              </p>
            </div>
            <button
              onClick={() => {
                setActivityOptedOut(e.malId, true)
                toast.info(`Muted ${titleFor(e.malId)}`, 2500)
              }}
              aria-label="Mute this show"
              title="Mute this show + cancel pending"
              className="opacity-60 group-hover:opacity-100 p-1.5 rounded-md text-white/60 hover:text-red-300 hover:bg-red-500/10 transition-all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function formatEpisodeList(eps: number[]): string {
  if (eps.length === 1) return `EP ${eps[0]}`
  const min = eps[0], max = eps[eps.length - 1]
  if (eps.length === max - min + 1) return `EP ${min}–${max}`
  if (eps.length <= 5) return `EP ${eps.join(', ')}`
  return `EP ${eps.slice(0, 4).join(', ')} +${eps.length - 4}`
}

// ──────────────────────────────────────────────────────────────────
// MUTED TAB
// ──────────────────────────────────────────────────────────────────

function MutedTab() {
  const [mutedIds, setMutedIds] = useState<number[]>(() => getOptedOutMalIds())
  const watchlist = useWatchListStore((s) => s.watchlist)
  const continueWatching = useWatchListStore((s) => s.continueWatching)
  const [filter, setFilter] = useState('')

  // Refresh whenever opt-outs change (e.g. via PendingActivityChip)
  useEffect(() => {
    const refresh = () => setMutedIds(getOptedOutMalIds())
    // Poll because there's no built-in pub/sub for opt-outs.
    // Cheap (just a localStorage read every 2s); acceptable for an admin page.
    const tick = window.setInterval(refresh, 2000)
    return () => window.clearInterval(tick)
  }, [])

  const items = useMemo(() => {
    return mutedIds.map((id) => {
      const a =
        watchlist.find((x) => x.mal_id === id) ??
        continueWatching.find((c) => c.anime.mal_id === id)?.anime
      return {
        malId: id,
        anime: a,
        title: a?.title_english || a?.title || `MAL #${id}`,
      }
    }).filter((x) => {
      if (!filter.trim()) return true
      return x.title.toLowerCase().includes(filter.toLowerCase())
    })
  }, [mutedIds, watchlist, continueWatching, filter])

  if (mutedIds.length === 0) {
    return (
      <EmptyCard
        icon={<EyeOff className="h-6 w-6 text-primary" />}
        title="No muted shows"
        message="Mute a show via the 'Activity on / Activity muted' toggle on its details page. They'll appear here so you can un-mute easily."
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="glass-card rounded-xl px-3 py-2 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          type="text"
          placeholder="Filter muted shows…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-transparent border-none outline-none text-sm w-full text-white placeholder:text-muted-foreground"
        />
        {filter && (
          <button onClick={() => setFilter('')} aria-label="Clear filter">
            <X className="h-3 w-3 text-muted-foreground hover:text-white" />
          </button>
        )}
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {items.length} / {mutedIds.length}
        </span>
      </div>

      {items.map((item) => (
        <div key={item.malId} className="glass-card rounded-xl p-3 flex items-center gap-3 group">
          {item.anime ? (
            <Link to={`/anime/${item.malId}`}>
              <img
                src={getSmallImageUrl(item.anime)}
                alt=""
                className="h-12 w-9 rounded object-cover shrink-0 border border-white/10 hover:border-primary/50 transition-colors"
              />
            </Link>
          ) : (
            <div className="h-12 w-9 rounded bg-card shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <Link
              to={`/anime/${item.malId}`}
              className="text-sm font-semibold text-white hover:text-primary truncate block transition-colors"
            >
              {item.title}
            </Link>
            <p className="text-[10px] text-muted-foreground">
              MAL #{item.malId}
            </p>
          </div>
          <button
            onClick={() => {
              setActivityOptedOut(item.malId, false)
              setMutedIds(getOptedOutMalIds())
              toast.success(`Re-enabled activity for ${item.title}`, 3000)
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 text-xs font-bold border border-emerald-500/25 hover:bg-emerald-500/15 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Un-mute
          </button>
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Shared small components
// ──────────────────────────────────────────────────────────────────

function EmptyCard({
  icon, title, message, cta,
}: {
  icon: React.ReactNode
  title: string
  message: string
  cta?: { label: string; to: string }
}) {
  return (
    <div className="glass-card rounded-2xl p-8 text-center">
      <div className="h-12 w-12 rounded-xl bg-primary/15 grid place-items-center mx-auto mb-3">
        {icon}
      </div>
      <h2 className="text-base font-bold text-white mb-1">{title}</h2>
      <p className="text-sm text-white/55 max-w-sm mx-auto leading-relaxed">{message}</p>
      {cta && (
        <Link
          to={cta.to}
          className="inline-flex items-center gap-2 mt-5 bg-white/8 hover:bg-white/15 text-white px-4 py-2 rounded-lg text-sm font-semibold border border-white/10"
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="glass-card rounded-2xl p-6 flex items-start gap-3 border border-red-500/20 bg-red-500/[0.02]">
      <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-bold text-white">{title}</p>
        <p className="text-xs text-white/55 mt-1">{message}</p>
      </div>
    </div>
  )
}
