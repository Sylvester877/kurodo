// Bidirectional sync between local watchlist + AniList.
//
// • When signed in, every local mutation (addToWatchlist, removeFromWatchlist,
//   markEpisodeWatched) is mirrored to AniList in the background.
// • On sign-in we PULL the AniList list down into the local store so the user
//   sees their existing entries (deduplicated by mal_id).
// • If a mutation fails (token expired, network down), we just log + toast —
//   the local copy stays correct so the UX never breaks.

import {
  saveListEntry, deleteListEntry, fetchUserList, postTextActivity,
  type AniListEntry, type ListStatus,
} from '../api/anilistAuth'
import { getAniListIdFromMal } from '../api/anilist'
import { getBackendOrigin } from './utils'
import { useAuthStore } from '../store/useAuthStore'
import { useWatchListStore, setSyncCallbacks } from '../store/useWatchListStore'
import { getSettings } from '../store/useSettings'
import { toast } from '../components/Toaster'
import type { Anime } from '../types'

// Wire fire-and-forget hooks into the watchlist store. Called once from
// main.tsx so the store doesn't need a direct dependency on sync.ts
// (avoids a circular import that was silently breaking mirroring).
export function initSyncBridge(): void {
  setSyncCallbacks({
    onAdd:      (anime)    => { void syncAdd(anime) },
    onRemove:   (id)       => { void syncRemove(id) },
    onProgress: (id, ep)   => { void syncProgress(id, ep) },
  })
}

// Map MAL id → AniList list entry id (so we can DELETE later).
const malToEntryId = new Map<number, number>()

// MAL id → total episode count (so syncProgress can auto-complete).
// Populated by pullFromAniList; falls back to a one-shot AniList lookup
// when syncProgress needs the count and we don't have it cached.
const malToTotalEpisodes = new Map<number, number>()

// MAL id → AniList anime id (avoid the mal→anilist round trip on each
// progress update). Populated by pull + on the fly.
const malToAniId = new Map<number, number>()

// MAL id → user's current AniList status (CURRENT/COMPLETED/etc.).
// Lets syncProgress avoid downgrading COMPLETED back to CURRENT when
// the user re-watches an episode they've already finished.
const malToStatus = new Map<number, ListStatus>()

function getToken(): string | null {
  return useAuthStore.getState().auth?.token ?? null
}

// ─────────────────────────────────────────────────────────────────
// One-way: push local actions to AniList
// ─────────────────────────────────────────────────────────────────
export async function syncAdd(anime: Anime) {
  const token = getToken()
  if (!token) return
  try {
    const aniId = await getAniListIdFromMal(anime.mal_id)
    if (!aniId) return
    // Don't pass status — AniList preserves the existing status for
    // updates (so we don't downgrade CURRENT/COMPLETED back to PLANNING),
    // and defaults to PLANNING for brand-new entries.
    const entryId = await saveListEntry(token, { mediaId: aniId })
    malToEntryId.set(anime.mal_id, entryId)
  } catch (e) {
    console.warn('AniList sync (add) failed', e)
  }
}

export async function syncRemove(malId: number) {
  const token = getToken()
  if (!token) return
  const entryId = malToEntryId.get(malId)
  if (!entryId) return
  try {
    await deleteListEntry(token, entryId)
    malToEntryId.delete(malId)
  } catch (e) {
    console.warn('AniList sync (remove) failed', e)
  }
}

/**
 * Look up an AniList anime id for a MAL id, hitting the cache first.
 * Saves one round-trip per progress update for any anime we've seen
 * through pull/backfill.
 */
async function getAniIdCached(malId: number): Promise<number | null> {
  const cached = malToAniId.get(malId)
  if (cached) return cached
  const fetched = await getAniListIdFromMal(malId)
  if (fetched) malToAniId.set(malId, fetched)
  return fetched ?? null
}

/**
 * One-shot fetch + cache of the total episode count for a media id.
 * Called by syncProgress when we don't already know the count (e.g.
 * the user added a show locally before signing in to AniList).
 */
async function getTotalEpisodesCached(malId: number, aniId: number): Promise<number | null> {
  const cached = malToTotalEpisodes.get(malId)
  if (cached != null) return cached
  try {
    const { fetchMediaCounts } = await import('../api/anilist')
    const ep = await fetchMediaCounts(aniId)
    if (ep != null) malToTotalEpisodes.set(malId, ep)
    return ep
  } catch {
    return null
  }
}

export async function syncProgress(malId: number, episode: number) {
  const token = getToken()
  if (!token) return
  if (getSettings().autoSyncAniList === false) {
    console.log('[sync] AniList auto-sync disabled; skipping progress update')
    return
  }
  try {
    const aniId = await getAniIdCached(malId)
    if (!aniId) return

    // ── Pick the right status ────────────────────────────────────
    // • Existing entry is COMPLETED / REPEATING / DROPPED / PAUSED?
    //   → leave its status alone. The user may be re-watching or just
    //   spot-checking an episode; don't surprise them by flipping it
    //   back to CURRENT.
    // • Finished the last episode? → COMPLETED
    // • Otherwise → CURRENT (actively watching)
    const total = await getTotalEpisodesCached(malId, aniId)
    const isFinished = total != null && episode >= total
    const prev = malToStatus.get(malId)
    const preserve =
      prev === 'COMPLETED' || prev === 'REPEATING' ||
      prev === 'DROPPED'   || prev === 'PAUSED'
    let status: ListStatus | undefined
    if (preserve && !isFinished) {
      status = undefined  // don't touch the status field
    } else {
      status = isFinished ? 'COMPLETED' : 'CURRENT'
    }

    const entryId = await saveListEntry(token, {
      mediaId: aniId,
      ...(status ? { status } : {}),
      progress: episode,
    })
    malToEntryId.set(malId, entryId)
    if (status) malToStatus.set(malId, status)

    // Surface auto-completion — dispatch an event for the completion dialog
    // instead of showing a toast. The dialog offers a star rating picker.
    if (isFinished) {
      const anime =
        useWatchListStore.getState().watchlist.find((a) => a.mal_id === malId) ??
        useWatchListStore.getState().continueWatching.find((c) => c.anime.mal_id === malId)?.anime
      if (anime && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kurodo:anime-completed', {
          detail: { malId, aniId, title: anime.title_english || anime.title || '', totalEpisodes: total },
        }))
      }
    }
  } catch (e) {
    console.warn('AniList sync (progress) failed', e)
  }

  // Schedule a batched activity post (silent for solo episodes, one
  // "Watched X–Y" post for binges)
  queueActivity(malId, episode)
}

// ─────────────────────────────────────────────────────────────────
// Auto-batched activity posts
// ─────────────────────────────────────────────────────────────────
//
//  • When you mark episodes 2, 3, 4, 5 within a minute, we coalesce them
//    into ONE post: "📺 Watched episodes 2–5 of {title} on Kurōdo"
//  • A single episode → no post (avoids feed spam)
//  • Per-anime opt-out is persisted to localStorage and exposed in UI.
//
const activityBuffer = new Map<number, { episodes: Set<number>; timer: number }>()
const ACTIVITY_OPT_OUT_KEY = 'kurodo-activity-opted-out'

/** Read the auto-flush debounce from user settings, clamped to a sane range. */
function getFlushMs(): number {
  const s = getSettings().activityFlushSeconds
  const clamped = Math.max(5, Math.min(600, Number(s) || 60))
  return clamped * 1000
}

// ─── Pending-activity subscribers ────────────────────────────────
// Lightweight pub/sub so UI components can watch the buffer without
// polling. Each subscriber gets called after every queue/flush change.
type PendingSubscriber = () => void
const pendingSubscribers = new Set<PendingSubscriber>()
function notifyPendingChanged() {
  for (const fn of pendingSubscribers) {
    try { fn() } catch { /* ignore */ }
  }
}

/** Subscribe to changes in the pending-activity buffer. Returns unsub. */
export function subscribePendingActivity(fn: PendingSubscriber): () => void {
  pendingSubscribers.add(fn)
  return () => { pendingSubscribers.delete(fn) }
}

export interface PendingActivityEntry {
  malId: number
  episodes: number[]
  /** Approx ms until the auto-flush fires. */
  flushesInMs: number
}

/** Read the current buffer as a serializable snapshot. */
export function getPendingActivity(): PendingActivityEntry[] {
  const out: PendingActivityEntry[] = []
  for (const [malId, buf] of activityBuffer) {
    // We can't read the setTimeout's remaining time directly. Track an
    // approximate scheduled-at on the buf itself (set in queueActivity).
    const scheduledAt = (buf as unknown as { _scheduledAt?: number })._scheduledAt ?? Date.now()
    const flushesInMs = Math.max(0, getFlushMs() - (Date.now() - scheduledAt))
    out.push({
      malId,
      episodes: [...buf.episodes].sort((a, b) => a - b),
      flushesInMs,
    })
  }
  return out
}

function loadOptOuts(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ACTIVITY_OPT_OUT_KEY) || '[]'))
  } catch {
    return new Set()
  }
}
function saveOptOuts(set: Set<number>) {
  localStorage.setItem(ACTIVITY_OPT_OUT_KEY, JSON.stringify([...set]))
}
export function isActivityOptedOut(malId: number): boolean {
  return loadOptOuts().has(malId)
}
/** All MAL ids currently muted from activity posting. */
export function getOptedOutMalIds(): number[] {
  return [...loadOptOuts()]
}

export function setActivityOptedOut(malId: number, optedOut: boolean) {
  const s = loadOptOuts()
  if (optedOut) s.add(malId)
  else s.delete(malId)
  saveOptOuts(s)
}

function queueActivity(malId: number, episode: number) {
  if (getSettings().autoPostActivity === false) return
  if (isActivityOptedOut(malId)) return
  const existing = activityBuffer.get(malId)
  if (existing) {
    existing.episodes.add(episode)
    window.clearTimeout(existing.timer)
    existing.timer = window.setTimeout(() => flushActivity(malId), getFlushMs())
    ;(existing as unknown as { _scheduledAt: number })._scheduledAt = Date.now()
  } else {
    const timer = window.setTimeout(() => flushActivity(malId), getFlushMs())
    const buf = { episodes: new Set([episode]), timer }
    ;(buf as unknown as { _scheduledAt: number })._scheduledAt = Date.now()
    activityBuffer.set(malId, buf)
  }
  notifyPendingChanged()
}

/**
 * Format the episode tokens used in the headline.
 *   1 ep         → "episode 5"
 *   contiguous   → "episodes 2–8"
 *   scattered    → "episodes 2, 5, 9"   (capped at 6 then truncated)
 */
function formatEpisodes(eps: number[]): string {
  if (eps.length === 1) return `episode ${eps[0]}`
  const min = eps[0]
  const max = eps[eps.length - 1]
  if (eps.length === max - min + 1) return `episodes ${min}–${max}`
  if (eps.length <= 6) return `episodes ${eps.join(', ')}`
  return `episodes ${eps.slice(0, 5).join(', ')}, +${eps.length - 5} more`
}

/** Pick a contextual emoji for the headline based on what was watched. */
function contextEmoji(eps: number[], isLast: boolean): string {
  if (isLast) return '🎉'
  if (eps.length >= 5) return '🔥'
  if (eps.length >= 2) return '📺'
  return '🎬'
}

/**
 * Render the headline using either the user's custom template or the
 * default. Supports {title}, {episodes}, {emoji} tokens.
 */
function renderHeadline(template: string, ctx: {
  title: string
  episodes: string
  emoji: string
}): string {
  const tpl = template?.trim() ||
    '{emoji} Watched {episodes} of **{title}**'
  return tpl
    .replace(/\{title\}/g, ctx.title)
    .replace(/\{episodes\}/g, ctx.episodes)
    .replace(/\{emoji\}/g, ctx.emoji)
}

/**
 * Build the full activity body. Headline → optional Kurōdo branded
 * sign-off with a backlink to the exact episode (drives traffic).
 *
 * Exported (with the underscore prefix) for the in-Settings preview.
 */
export function _buildActivityText(args: {
  title: string
  malId: number
  eps: number[]
  isLast: boolean
  template: string
  branded: boolean
}): string {
  const episodes = formatEpisodes(args.eps)
  const emoji = contextEmoji(args.eps, args.isLast)
  const head = renderHeadline(args.template, { title: args.title, episodes, emoji })

  if (!args.branded) return head

  // Branded sign-off — short, tasteful, has the backlink + tag.
  // Italics + small text via AniList's markdown.
  const lastEp = args.eps[args.eps.length - 1]
  const url = `https://kurodo.me/watch/${args.malId}?ep=${lastEp}`
  const tag = args.isLast
    ? 'Finished this on'
    : args.eps.length >= 2
    ? 'Bingeing on'
    : 'Watching on'
  return `${head}\n\n~~~${tag} [Kurōdo](${url}) — fast, ad-free, AniList-synced.~~~`
}

async function flushActivity(malId: number) {
  const buf = activityBuffer.get(malId)
  if (!buf) return
  activityBuffer.delete(malId)
  notifyPendingChanged()

  const { auth } = useAuthStore.getState()
  if (!auth) return

  const settings = getSettings()
  const eps = [...buf.episodes].sort((a, b) => a - b)
  // Respect the user's min-episodes threshold (default 1 — every watch
  // event posts so the app can spread organically).
  if (eps.length < (settings.activityMinEpisodes ?? 1)) return

  // Look up the anime title from the local watchlist (lazy & free).
  const anime =
    useWatchListStore.getState().watchlist.find((a) => a.mal_id === malId) ??
    useWatchListStore.getState().continueWatching.find((c) => c.anime.mal_id === malId)?.anime
  const title = anime?.title_english || anime?.title || `MAL #${malId}`

  // Detect "this was the finale" so we can render a special headline +
  // backlink tagged "Finished on".
  const total = malToTotalEpisodes.get(malId) ?? null
  const isLast = total != null && eps[eps.length - 1] >= total

  const text = _buildActivityText({
    title, malId, eps, isLast,
    template: settings.activityTemplate ?? '',
    branded: settings.activityBranded !== false,
  })

  try {
    await postTextActivity(auth.token, text)
    const epsLabel = formatEpisodes(eps)
    toast.success(
      isLast
        ? `🎉 Posted: just finished ${title}!`
        : `Posted to AniList: ${epsLabel}`,
      4000,
    )
  } catch (e) {
    console.warn('AniList activity post failed', e)
  }
}

/** Manual flush — called from the navbar/account menu if you want it now. */
export function flushAllActivity() {
  const ids = [...activityBuffer.keys()]
  for (const id of ids) flushActivity(id)
}

// ─────────────────────────────────────────────────────────────────
// Pull AniList → local on sign-in
// ─────────────────────────────────────────────────────────────────
function entryToAnime(e: AniListEntry): Anime | null {
  if (!e.media.idMal) return null
  const cover = e.media.coverImage.large ?? ''
  // Build a minimal Anime that's compatible with our local store
  return {
    mal_id: e.media.idMal,
    title: e.media.title.romaji || e.media.title.english || '',
    title_english: e.media.title.english,
    title_japanese: e.media.title.native,
    synopsis: null,
    score: e.media.averageScore ? e.media.averageScore / 10 : null,
    scored_by: null, rank: null, popularity: null, members: null, favorites: null,
    images: {
      jpg: { image_url: cover, small_image_url: cover, large_image_url: cover },
      webp: { image_url: cover, small_image_url: cover, large_image_url: cover },
    },
    trailer: {
      youtube_id: null, url: null, embed_url: null,
      images: {
        image_url: null, small_image_url: null,
        medium_image_url: null, large_image_url: null, maximum_image_url: null,
      },
    },
    type: e.media.format || 'TV',
    status: '', episodes: e.media.episodes,
    duration: null, rating: null,
    aired: { from: null, to: null, string: null },
    season: null, year: null,
    genres: [], studios: [], themes: [], demographics: [],
  } as Anime
}

// ─────────────────────────────────────────────────────────────────
// Playlist summary (read-only, used by the Import Playlist dialog
// to show the user a per-status breakdown BEFORE they commit to
// importing anything).
// ─────────────────────────────────────────────────────────────────
export interface AniListPlaylistSummary {
  entries: AniListEntry[]
  counts: Record<ListStatus, number>
  total: number
}

/** Fetch the full AniList anime list and bucket it by status. Does NOT
 *  mutate the local store — the caller decides what to import. */
export async function getAniListPlaylistSummary(): Promise<AniListPlaylistSummary | null> {
  const { auth } = useAuthStore.getState()
  if (!auth) return null
  try {
    const entries = await fetchUserList(auth.token, auth.user.id)
    const counts: Record<ListStatus, number> = {
      CURRENT: 0, PLANNING: 0, COMPLETED: 0,
      DROPPED: 0, PAUSED: 0, REPEATING: 0,
    }
    for (const e of entries) counts[e.status]++
    return { entries, counts, total: entries.length }
  } catch (e) {
    console.warn('AniList playlist summary failed', e)
    return null
  }
}

/** Called from useEffect after sign-in. Imports AniList list into local. */
export async function pullFromAniList(): Promise<void> {
  const { auth } = useAuthStore.getState()
  if (!auth) return
  try {
    const entries = await fetchUserList(auth.token, auth.user.id)
    const store = useWatchListStore.getState()
    let imported = 0
    let resumed = 0
    for (const entry of entries) {
      const a = entryToAnime(entry)
      if (!a) continue
      malToEntryId.set(a.mal_id, entry.id)
      malToAniId.set(a.mal_id, entry.media.id)
      malToStatus.set(a.mal_id, entry.status)
      if (entry.media.episodes != null) {
        malToTotalEpisodes.set(a.mal_id, entry.media.episodes)
      }
      if (!store.isInWatchlist(a.mal_id)) {
        // Add silently — bypass the toast that addToWatchlist normally fires
        useWatchListStore.setState((s) => ({ watchlist: [...s.watchlist, a] }))
        imported++
      }
      // Restore progress as continue-watching for CURRENT entries
      if (entry.status === 'CURRENT' && entry.progress > 0) {
        store.setLastWatched(a, entry.progress)
        resumed++
      }
    }
    if (imported > 0 || resumed > 0) {
      toast.success(
        `Synced ${imported} from AniList${resumed > 0 ? ` · ${resumed} resumed` : ''}`,
      )
    }
  } catch (e) {
    console.warn('AniList pull failed', e)
    if (e instanceof Error && e.name === 'AniListRateLimitError') {
      toast.error('AniList is rate-limiting us — your list will sync again shortly')
    } else {
      toast.error('Could not load your AniList — token may be expired')
    }
  }
}

// ─────────────────────────────────────────────────────────────────
// Username-based import — no sign-in required
// ─────────────────────────────────────────────────────────────────

import type { PublicAniListEntry } from '../api/anilist'
import { type MalXmlEntry } from './malXml'
import type { PlaylistStatus } from '../store/useWatchListStore'

/** Same shape as AniListPlaylistSummary but using PublicAniListEntry. */
export interface AniListUsernameSummary {
  entries: PublicAniListEntry[]
  counts: Record<string, number>
  total: number
}

/** Fetch a public AniList user's anime list and bucket by status. */
export async function getAniListUsernameSummary(userName: string): Promise<AniListUsernameSummary> {
  const { getUserAnimeList } = await import('../api/anilist')
  const entries = await getUserAnimeList(userName)
  const counts: Record<string, number> = {
    CURRENT: 0, PLANNING: 0, COMPLETED: 0,
    DROPPED: 0, PAUSED: 0, REPEATING: 0,
  }
  for (const e of entries) counts[e.status]++
  return { entries, counts, total: entries.length }
}

/** Fetch a MAL user's anime list via the backend proxy and bucket by status. */
export async function getMalUsernameSummary(userName: string): Promise<{
  entries: MalXmlEntry[]
  counts: Record<PlaylistStatus, number>
  total: number
}> {
  const { default: axios } = await import('axios')
  const { data } = await axios.get<{
    ok: boolean
    data: { entries: MalXmlEntry[]; counts: Record<PlaylistStatus, number>; total: number }
    error?: string
  }>(`${getBackendOrigin()}/api/mal/animelist?user=${encodeURIComponent(userName)}`)
  if (!data?.ok || !data?.data) {
    throw new Error(data?.error || 'Failed to fetch MAL list — ensure the backend server is running (npm start)')
  }
  return data.data
}

// ─────────────────────────────────────────────────────────────────
// Best-effort: try to find the AniList ID we'd need for syncRemove
// (called once on app start so the delete button works for items that
// were already in localStorage before the user signed in).
// ─────────────────────────────────────────────────────────────────
export async function backfillEntryIds() {
  const { auth } = useAuthStore.getState()
  if (!auth) return
  try {
    const entries = await fetchUserList(auth.token, auth.user.id)
    for (const e of entries) {
      if (e.media.idMal) {
        malToEntryId.set(e.media.idMal, e.id)
        malToAniId.set(e.media.idMal, e.media.id)
        malToStatus.set(e.media.idMal, e.status)
        if (e.media.episodes != null) malToTotalEpisodes.set(e.media.idMal, e.media.episodes)
      }
    }
  } catch {
    /* ignore */
  }
}

// Expose a no-op helper for store tests
export function _resetSyncCache() { malToEntryId.clear(); malToTotalEpisodes.clear(); malToAniId.clear(); malToStatus.clear() }


