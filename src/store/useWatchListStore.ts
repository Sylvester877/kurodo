import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Anime } from '../types'
import { toast } from '../components/Toaster'

/**
 * True when the anime carries a real remote poster URL. The details-page
 * stub (used when every upstream is down) fills images with a `data:`
 * placeholder SVG that renders the literal text "No Image" — saving those
 * stub objects into continue-watching poisoned the Home rail with
 * permanently-broken "No Image" cards. Never persist them.
 */
function hasUsablePoster(anime: Anime): boolean {
  // Guard against legacy/corrupt persisted entries with a missing anime object.
  if (!anime) return false
  const img = anime.images?.webp?.large_image_url || anime.images?.jpg?.large_image_url
  return typeof img === 'string' && img.startsWith('http')
}

// ─────────────────────────────────────────────────────────────────
// Per-anime playlist status — populated when importing from AniList
// (CURRENT/PLANNING/COMPLETED/DROPPED/PAUSED/REPEATING) or MAL XML
// (Watching/Completed/OnHold/Dropped/PlanToWatch). Optional, so the
// store stays backwards-compatible: anything missing is treated as
// "in the list, status unknown".
// ─────────────────────────────────────────────────────────────────
export type PlaylistStatus =
  | 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING'
  | 'WATCHING' | 'ON_HOLD' | 'PLAN_TO_WATCH'

export interface PlaylistMeta {
  status: PlaylistStatus
  /** User score (0–10). 0 means unrated. */
  score: number
  /** Watched episode count at the time of import. */
  watchedEpisodes: number
  /** Source service for the import (for display in the import dialog). */
  source: 'anilist' | 'mal' | 'kurodo' | 'manual'
  /** Unix ms when this meta was last refreshed. */
  importedAt: number
}

// ─────────────────────────────────────────────────────────────────
// Side-effect hooks for sync layer.
// The watchlist store doesn't import the sync module directly — that
// caused a circular dependency (sync ↔ store) which silently broke
// AniList mirroring. Instead, sync.ts calls `setSyncCallbacks()` once
// at app boot and the store invokes them as fire-and-forget hooks.
// ─────────────────────────────────────────────────────────────────
interface SyncCallbacks {
  onAdd?: (anime: Anime) => void
  onRemove?: (animeId: number) => void
  onProgress?: (animeId: number, episode: number) => void
}
let syncCallbacks: SyncCallbacks = {}
export function setSyncCallbacks(cbs: SyncCallbacks) {
  syncCallbacks = cbs
}

interface ContinueEntry {
  anime: Anime
  episode: number
  updatedAt: number
}

export interface WatchEvent {
  animeId: number
  episode: number
  /** Unix ms when the episode was first marked watched. */
  at: number
}

/** Per-episode playback progress for resume-where-you-left-off. */
export interface EpisodeProgress {
  /** Current playback position in seconds. */
  time: number
  /** Total video duration in seconds (0 if not yet known). */
  duration: number
  /** Last-saved timestamp (ms). */
  at: number
}

interface WatchListStore {
  watchlist: Anime[]
  watchedEpisodes: Record<number, number[]>
  continueWatching: ContinueEntry[]
  /** Timestamped log of every episode watched — used by /profile stats. */
  watchHistory: WatchEvent[]
  /** Resume positions keyed by "malId-ep" e.g. "21-7". Capped to last 500. */
  episodeProgress: Record<string, EpisodeProgress>
  /** Per-anime playlist metadata (status, score, import source). */
  playlistMeta: Record<number, PlaylistMeta>
  addToWatchlist: (anime: Anime) => void
  removeFromWatchlist: (animeId: number) => void
  isInWatchlist: (animeId: number) => boolean
  markEpisodeWatched: (animeId: number, episodeNumber: number, opts?: { skipSync?: boolean }) => void
  isEpisodeWatched: (animeId: number, episodeNumber: number) => boolean
  getWatchedCount: (animeId: number) => number
  setLastWatched: (anime: Anime, episode: number) => void
  removeFromContinue: (animeId: number) => void
  getLastEpisode: (animeId: number) => number | null
  /** Save the user's current position in an episode (debounced by caller). */
  setEpisodeProgress: (animeId: number, episode: number, time: number, duration: number) => void
  /** Get saved progress for an episode (null if unknown / too stale). */
  getEpisodeProgress: (animeId: number, episode: number) => EpisodeProgress | null
  /** Forget saved progress for an episode (e.g. user clicked "Start over"). */
  clearEpisodeProgress: (animeId: number, episode: number) => void
  /** Get playlist meta for an anime (null if not in playlist or untracked). */
  getPlaylistMeta: (animeId: number) => PlaylistMeta | null
  /** Bulk-set playlist meta for an imported batch. */
  setPlaylistMetaBatch: (entries: Array<{ malId: number; meta: PlaylistMeta }>) => void
  /** Update a single anime's playlist status. */
  setPlaylistStatus: (animeId: number, status: PlaylistStatus) => void
  /** Reorder the watchlist by moving an item from one index to another. */
  reorderWatchlist: (fromIndex: number, toIndex: number) => void
}

export const useWatchListStore = create<WatchListStore>()(
  persist(
    (set, get) => ({
      watchlist: [],
      watchedEpisodes: {},
      continueWatching: [],
      watchHistory: [],
      episodeProgress: {},
      playlistMeta: {},

      setLastWatched: (anime, episode) =>
        set((state) => {
          // Never persist stub anime (placeholder/no poster) — they'd show
          // "No Image" on the dashboard forever.
          if (!hasUsablePoster(anime)) return state
          const filtered = state.continueWatching.filter(
            (c) => hasUsablePoster(c?.anime) && c?.anime?.mal_id !== anime.mal_id,
          )
          const entry: ContinueEntry = {
            anime,
            episode,
            updatedAt: Date.now(),
          }
          return { continueWatching: [entry, ...filtered].slice(0, 20) }
        }),

      removeFromContinue: (animeId) =>
        set((state) => ({
          continueWatching: state.continueWatching.filter(
            (c) => c.anime.mal_id !== animeId,
          ),
        })),

      getLastEpisode: (animeId) =>
        get().continueWatching
          .filter((c) => c.anime.mal_id === animeId)
          .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.episode ?? null,

      // ── Resume mid-episode ─────────────────────────────────────────
      // Persisted across sessions in localStorage. We cap the total
      // number of stored entries to 500 (keeping the most recently
      // updated) so the cache can't grow unbounded for power users.
      setEpisodeProgress: (animeId, episode, time, duration) =>
        set((state) => {
          const key = `${animeId}-${episode}`
          // Skip very-near-start writes — saves us churning localStorage
          // on every video that hasn't really been started yet.
          if (time < 5) {
            // ...unless we already have an entry; in that case clearing
            // a fresh-restart at <5s is fine.
            if (!state.episodeProgress[key]) return state
          }
          const next: Record<string, EpisodeProgress> = {
            ...state.episodeProgress,
            [key]: { time, duration, at: Date.now() },
          }
          // Cap to 500 entries — drop oldest first.
          const keys = Object.keys(next)
          if (keys.length > 500) {
            const sorted = keys.sort((a, b) => next[b].at - next[a].at)
            for (const k of sorted.slice(500)) delete next[k]
          }
          return { episodeProgress: next }
        }),

      getEpisodeProgress: (animeId, episode) => {
        const key = `${animeId}-${episode}`
        const entry = get().episodeProgress[key]
        if (!entry) return null
        // Forget entries older than 90 days — anime memory has a half-life.
        const MAX_AGE = 90 * 24 * 60 * 60 * 1000
        if (Date.now() - entry.at > MAX_AGE) return null
        return entry
      },

      clearEpisodeProgress: (animeId, episode) =>
        set((state) => {
          const key = `${animeId}-${episode}`
          if (!(key in state.episodeProgress)) return state
          const next = { ...state.episodeProgress }
          delete next[key]
          return { episodeProgress: next }
        }),

      addToWatchlist: (anime) =>
        set((state) => {
          if (state.watchlist.some((a) => a.mal_id === anime.mal_id)) return state
          toast.success(`Added "${anime.title_english || anime.title}" to your list`)
          syncCallbacks.onAdd?.(anime)
          return { watchlist: [...state.watchlist, anime] }
        }),

      removeFromWatchlist: (animeId) =>
        set((state) => {
          const removed = state.watchlist.find((a) => a.mal_id === animeId)
          if (removed) {
            toast.info(`Removed "${removed.title_english || removed.title}" from your list`)
            syncCallbacks.onRemove?.(animeId)
          }
          return {
            watchlist: state.watchlist.filter((a) => a.mal_id !== animeId),
            watchedEpisodes: Object.fromEntries(
              Object.entries(state.watchedEpisodes).filter(([key]) => Number(key) !== animeId)
            ),
          }
        }),

      isInWatchlist: (animeId) => get().watchlist.some((a) => a.mal_id === animeId),

      markEpisodeWatched: (animeId, episodeNumber, opts) =>
        set((state) => {
          const watched = state.watchedEpisodes[animeId] || []
          if (watched.includes(episodeNumber)) {
            return {
              watchedEpisodes: {
                ...state.watchedEpisodes,
                [animeId]: watched.filter((e) => e !== episodeNumber),
              },
            }
          }
          const next = [...watched, episodeNumber].sort((a, b) => a - b)
          // Mirror progress to AniList using the *highest* watched episode
          if (!opts?.skipSync) syncCallbacks.onProgress?.(animeId, next[next.length - 1])
          // Log to history (keep last 5000 to bound localStorage growth)
          const event: WatchEvent = { animeId, episode: episodeNumber, at: Date.now() }
          const history = [...state.watchHistory, event].slice(-5000)
          return {
            watchedEpisodes: {
              ...state.watchedEpisodes,
              [animeId]: next,
            },
            watchHistory: history,
          }
        }),

      isEpisodeWatched: (animeId, episodeNumber) => {
        const watched = get().watchedEpisodes[animeId] || []
        return watched.includes(episodeNumber)
      },

      getWatchedCount: (animeId) => (get().watchedEpisodes[animeId] || []).length,

      getPlaylistMeta: (animeId) => get().playlistMeta[animeId] ?? null,

      setPlaylistMetaBatch: (entries) =>
        set((state) => {
          const next = { ...state.playlistMeta }
          for (const { malId, meta } of entries) {
            next[malId] = meta
          }
          return { playlistMeta: next }
        }),

      setPlaylistStatus: (animeId, status) =>
        set((state) => {
          const existing = state.playlistMeta[animeId]
          if (!existing) {
            return {
              playlistMeta: {
                ...state.playlistMeta,
                [animeId]: {
                  status,
                  score: 0,
                  watchedEpisodes: state.watchedEpisodes[animeId]?.length ?? 0,
                  source: 'manual',
                  importedAt: Date.now(),
                },
              },
            }
          }
          return {
            playlistMeta: {
              ...state.playlistMeta,
              [animeId]: { ...existing, status },
            },
          }
        }),

      reorderWatchlist: (fromIndex, toIndex) =>
        set((state) => {
          const next = [...state.watchlist]
          const [removed] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, removed)
          return { watchlist: next }
        }),
    }),
    {
      name: 'kurodo-watchlist',
      // Boot-time cleanup: silently drop any continue-watching entries saved
      // by older builds that stored stub anime (placeholder "No Image"
      // posters) during upstream outages.
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const existing = state.continueWatching ?? []
        const clean = existing.filter((c) => hasUsablePoster(c?.anime))
        if (clean.length !== existing.length) {
          useWatchListStore.setState({ continueWatching: clean })
        }
      },
    }
  )
)