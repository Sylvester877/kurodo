// Manga reading list — separate from anime watchlist.
// Tracks manga MAL IDs, read chapters, and current page position.
// Syncs read progress to AniList when signed in.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toast } from '../components/Toaster'

export interface MangaEntry {
  /** MAL ID (or fallback tracking ID if no MAL mapping exists). */
  mal_id: number
  /** AniList ID (for sync). */
  anilistId: number | null
  /** MangaDex manga ID — needed for 'Continue' → chapter lookup. */
  mangaDexId?: string | null
  title: string
  title_english: string | null
  coverUrl: string
  /** Total chapter count from AniList metadata. */
  chapters: number | null
  /** Format (Manga, Novel, One Shot, etc.). */
  format: string | null
  status: string | null
  /** Tags/genres. */
  genres: string[]
}

/** Per-chapter reading position for resume-where-you-left-off. */
export interface ChapterProgress {
  /** Current page number (0-indexed). */
  page: number
  /** Total pages in the chapter. */
  totalPages: number
  /** Last-saved timestamp (ms). */
  at: number
}

/** Entry in the Continue Reading rail for manga. */
export interface ContinueReadingEntry {
  mal_id: number
  mangaDexId: string | null
  atsuId: string | null
  title: string
  coverUrl: string
  chapterId: string
  chapter: string
  chapterTitle: string | null
  source: 'mangadex' | 'atsu'
  page: number
  totalPages: number
  anilistId: string | null
  timestamp: number
}

interface MangaListStore {
  mangaList: MangaEntry[]
  /** MAL ID → array of read chapter numbers (sorted). */
  readChapters: Record<number, number[]>
  /** "malId-chapterNum" → ChapterProgress for resume. Capped to last 300. */
  chapterProgress: Record<string, ChapterProgress>

  // ── List management ──
  addToMangaList: (entry: MangaEntry) => void
  removeFromMangaList: (malId: number) => void
  isInMangaList: (malId: number) => boolean

  // ── Chapter tracking ──
  markChapterRead: (malId: number, chapter: number) => void
  isChapterRead: (malId: number, chapter: number) => boolean
  getReadCount: (malId: number) => number
  /** Get the latest read chapter number (for "Continue Reading"). */
  getLatestChapter: (malId: number) => number | null

  // ── Resume position ──
  setChapterProgress: (malId: number, chapter: number, page: number, totalPages: number) => void
  getChapterProgress: (malId: number, chapter: number) => ChapterProgress | null
  clearChapterProgress: (malId: number, chapter: number) => void

  // ── Continue Reading rail ──
  continueReading: ContinueReadingEntry[]
  upsertContinueReading: (entry: ContinueReadingEntry) => void
  removeFromContinueReading: (malId: number) => void
  getContinueReading: () => ContinueReadingEntry[]
}

export const useMangaListStore = create<MangaListStore>()(
  persist(
    (set, get) => ({
      mangaList: [],
      readChapters: {},
      chapterProgress: {},
      continueReading: [],

      // ── List management ──
      addToMangaList: (entry) =>
        set((state) => {
          if (state.mangaList.some((m) => m.mal_id === entry.mal_id)) return state
          toast.success(`Added "${entry.title_english || entry.title}" to manga list`)
          return { mangaList: [...state.mangaList, entry] }
        }),

      removeFromMangaList: (malId) =>
        set((state) => {
          const removed = state.mangaList.find((m) => m.mal_id === malId)
          if (removed) {
            toast.info(`Removed "${removed.title_english || removed.title}" from manga list`)
          }
          const { [malId]: _, ...restRead } = state.readChapters
          return {
            mangaList: state.mangaList.filter((m) => m.mal_id !== malId),
            readChapters: restRead,
          }
        }),

      isInMangaList: (malId) => get().mangaList.some((m) => m.mal_id === malId),

      // ── Chapter tracking ──
      markChapterRead: (malId, chapter) =>
        set((state) => {
          const existing = state.readChapters[malId] || []
          if (existing.includes(chapter)) {
            // Toggle off
            return {
              readChapters: {
                ...state.readChapters,
                [malId]: existing.filter((c) => c !== chapter).sort((a, b) => a - b),
              },
            }
          }
          const next = [...existing, chapter].sort((a, b) => a - b)
          return {
            readChapters: {
              ...state.readChapters,
              [malId]: next,
            },
          }
        }),

      isChapterRead: (malId, chapter) => {
        const read = get().readChapters[malId] || []
        return read.includes(chapter)
      },

      getReadCount: (malId) => (get().readChapters[malId] || []).length,

      getLatestChapter: (malId) => {
        const read = get().readChapters[malId] || []
        if (read.length === 0) return null
        return read[read.length - 1]
      },

      // ── Resume position ──
      setChapterProgress: (malId, chapter, page, totalPages) =>
        set((state) => {
          const key = `${malId}-${chapter}`
          const existing = state.chapterProgress[key]
          // Don't save near-start positions
          if (page < 1) {
            if (!existing) return state
          }
          // Bail out if the value hasn't actually changed. Without this guard,
          // every page turn writes a new object and triggers a store update
          // that cascades into MangaReader re-renders (#185).
          if (
            existing &&
            existing.page === page &&
            existing.totalPages === totalPages
          ) {
            return state
          }
          const next: Record<string, ChapterProgress> = {
            ...state.chapterProgress,
            [key]: { page, totalPages, at: Date.now() },
          }
          // Cap to 300 entries
          const keys = Object.keys(next)
          if (keys.length > 300) {
            const sorted = keys.sort((a, b) => next[b].at - next[a].at)
            for (const k of sorted.slice(300)) delete next[k]
          }
          return { chapterProgress: next }
        }),

      getChapterProgress: (malId, chapter) => {
        const key = `${malId}-${chapter}`
        const entry = get().chapterProgress[key]
        if (!entry) return null
        // Forget entries older than 90 days
        const MAX_AGE = 90 * 24 * 60 * 60 * 1000
        if (Date.now() - entry.at > MAX_AGE) return null
        return entry
      },

      clearChapterProgress: (malId, chapter) =>
        set((state) => {
          const key = `${malId}-${chapter}`
          if (!(key in state.chapterProgress)) return state
          const next = { ...state.chapterProgress }
          delete next[key]
          return { chapterProgress: next }
        }),

      // ── Continue Reading rail ──
      upsertContinueReading: (entry) =>
        set((state) => {
          const existing = state.continueReading.findIndex(
            (e) => e.mal_id === entry.mal_id,
          )
          let next: ContinueReadingEntry[]
          if (existing >= 0) {
            next = [...state.continueReading]
            next[existing] = { ...entry, timestamp: Date.now() }
          } else {
            next = [{ ...entry, timestamp: Date.now() }, ...state.continueReading]
          }
          // Cap at 20 entries, remove oldest
          if (next.length > 20) next = next.slice(0, 20)
          return { continueReading: next }
        }),

      removeFromContinueReading: (malId) =>
        set((state) => ({
          continueReading: state.continueReading.filter(
            (e) => e.mal_id !== malId,
          ),
        })),

      getContinueReading: () => {
        const entries = get().continueReading
        // Sort by timestamp descending (most recent first)
        return [...entries].sort((a, b) => b.timestamp - a.timestamp)
      },
    }),
    { name: 'kurodo-manga-list' },
  ),
)
