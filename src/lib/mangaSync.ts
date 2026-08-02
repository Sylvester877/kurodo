// Manga sync — bidirectional sync between local manga list + AniList.
// Mirrors the anime sync pattern but for manga (type: MANGA, progress = chapters).
//
// • When signed in, chapter reads push to AniList as MangaListEntry progress.
// • On sign-in, pull manga list from AniList into the local store.
// • Auto-completes when last chapter is read.

import { saveListEntry, type ListStatus } from '../api/anilistAuth'
import { getMangaAniListId } from '../api/anilistManga'
import { useAuthStore } from '../store/useAuthStore'
import { useMangaListStore, type MangaEntry } from '../store/useMangaListStore'
import { toast } from '../components/Toaster'

// MAL id → AniList entry id (for DELETE/UPDATE)
const malToEntryId = new Map<number, number>()
// MAL id → AniList manga id
const malToAniId = new Map<number, number>()
// MAL id → total chapter count
const malToTotalChapters = new Map<number, number>()
// MAL id → current AniList status
const malToStatus = new Map<number, ListStatus>()

function getToken(): string | null {
  return useAuthStore.getState().auth?.token ?? null
}

/** Fetch manga entries from AniList for a user (type: MANGA). */
export async function fetchMangaList(token: string, userId: number): Promise<Array<{
  id: number
  mediaId: number
  status: ListStatus
  progress: number
  media: { id: number; idMal: number | null; title: { romaji: string; english: string | null }; coverImage: { large: string | null }; chapters: number | null; format: string | null; status: string | null; genres: string[] }
}>> {
  // Import the authenticated request function
  const { anilistRequest } = await import('../api/anilistClient')
  const data = await anilistRequest<{
    MediaListCollection: {
      lists: Array<{
        entries: Array<{
          id: number
          mediaId: number
          status: ListStatus
          progress: number
          media: {
            id: number
            idMal: number | null
            title: { romaji: string; english: string | null }
            coverImage: { large: string | null }
            chapters: number | null
            format: string | null
            status: string | null
            genres: string[]
          }
        }>
      }>
    }
  }>(
    `query ($userId: Int) {
      MediaListCollection(userId: $userId, type: MANGA) {
        lists {
          entries {
            id mediaId status progress
            media {
              id idMal
              title { romaji english }
              coverImage { large }
              chapters format status genres
            }
          }
        }
      }
    }`,
    { userId },
    { token },
  )
  return data.MediaListCollection?.lists?.flatMap((l) => l.entries) ?? []
}

/**
 * Push chapter read to AniList.
 * Auto-completes when the last chapter is read.
 */
export async function syncMangaProgress(malId: number, chapter: number) {
  const token = getToken()
  if (!token) return
  try {
    // Get or resolve AniList ID
    let aniId = malToAniId.get(malId)
    if (!aniId) {
      aniId = await getMangaAniListId(malId) ?? undefined
      if (aniId) malToAniId.set(malId, aniId)
    }
    if (!aniId) return

    // Get or resolve entry ID
    let entryId = malToEntryId.get(malId)
    if (!entryId) {
      // Try to find existing entry on AniList
      const entries = await fetchMangaList(token, useAuthStore.getState().auth!.user.id)
      const match = entries.find((e) => e.media.idMal === malId)
      if (match) {
        entryId = match.id
        malToEntryId.set(malId, entryId)
        malToStatus.set(malId, match.status)
        if (match.media.chapters) malToTotalChapters.set(malId, match.media.chapters)
      }
    }

    const total = malToTotalChapters.get(malId) ?? null
    const isFinished = total != null && chapter >= total
    const prev = malToStatus.get(malId)
    const preserve =
      prev === 'COMPLETED' || prev === 'REPEATING' ||
      prev === 'DROPPED' || prev === 'PAUSED'
    let status: ListStatus | undefined
    if (preserve && !isFinished) {
      status = undefined
    } else {
      status = isFinished ? 'COMPLETED' : 'CURRENT'
    }

    const args: { mediaId: number; status?: ListStatus; progress: number } = {
      mediaId: aniId,
      progress: chapter,
    }
    if (status) args.status = status

    const newEntryId = await saveListEntry(token, {
      mediaId: args.mediaId,
      status: args.status,
      progress: args.progress,
    })
    malToEntryId.set(malId, newEntryId)
    if (status) malToStatus.set(malId, status)

    // Toast on completion
    if (isFinished) {
      const manga = useMangaListStore.getState().mangaList.find((m) => m.mal_id === malId)
      const title = manga?.title_english || manga?.title || `MAL #${malId}`
      toast.success(`🎉 Marked "${title}" as Completed on AniList`, 4500)
    }
  } catch (e) {
    console.warn('Manga AniList sync failed', e)
  }
}

/**
 * Pull manga list from AniList on sign-in and merge into local store.
 */
export async function pullMangaFromAniList(): Promise<void> {
  const { auth } = useAuthStore.getState()
  if (!auth) return
  try {
    const entries = await fetchMangaList(auth.token, auth.user.id)
    const store = useMangaListStore.getState()
    let imported = 0
    let resumed = 0

    for (const entry of entries) {
      if (!entry.media.idMal) continue
      malToEntryId.set(entry.media.idMal, entry.id)
      malToAniId.set(entry.media.idMal, entry.media.id)
      malToStatus.set(entry.media.idMal, entry.status)
      if (entry.media.chapters != null) {
        malToTotalChapters.set(entry.media.idMal, entry.media.chapters)
      }

      if (!store.isInMangaList(entry.media.idMal!)) {
        const mangaEntry: MangaEntry = {
          mal_id: entry.media.idMal!,
          anilistId: entry.media.id,
          mangaDexId: null, // No MangaDex mapping when pulled from AniList
          title: entry.media.title.romaji || entry.media.title.english || '',
          title_english: entry.media.title.english || null,
          coverUrl: entry.media.coverImage?.large || '',
          chapters: entry.media.chapters,
          format: entry.media.format,
          status: entry.media.status,
          genres: entry.media.genres || [],
        }
        useMangaListStore.setState((s) => ({ mangaList: [...s.mangaList, mangaEntry] }))
        imported++
      }

      // Restore read chapters for CURRENT entries
      if (entry.progress > 0) {
        const existing = store.readChapters[entry.media.idMal!] || []
        const needsChapters = Array.from({ length: entry.progress }, (_, i) => i + 1)
          .filter((ch) => !existing.includes(ch))
        if (needsChapters.length > 0) {
          const next = [...existing, ...needsChapters].sort((a, b) => a - b)
          useMangaListStore.setState((s) => ({
            readChapters: { ...s.readChapters, [entry.media.idMal!]: next },
          }))
          resumed++
        }
      }
    }

    if (imported > 0 || resumed > 0) {
      toast.success(
        `Synced ${imported} manga from AniList${resumed > 0 ? ` · ${resumed} with progress` : ''}`,
      )
    }
  } catch (e) {
    console.warn('Manga AniList pull failed', e)
  }
}

/** Backfill entry IDs for already-saved manga. */
export async function backfillMangaEntryIds() {
  const { auth } = useAuthStore.getState()
  if (!auth) return
  try {
    const entries = await fetchMangaList(auth.token, auth.user.id)
    for (const e of entries) {
      if (e.media.idMal) {
        malToEntryId.set(e.media.idMal, e.id)
        malToAniId.set(e.media.idMal, e.media.id)
        malToStatus.set(e.media.idMal, e.status)
        if (e.media.chapters != null) malToTotalChapters.set(e.media.idMal, e.media.chapters)
      }
    }
  } catch { /* ignore */ }
}

/**
 * Initialise the manga sync bridge.
 * Called once at app startup — listens for auth changes
 * and triggers pull on sign-in / cleanup on sign-out.
 */
export function initMangaSyncBridge() {
  let lastUserId: number | null = null

  useAuthStore.subscribe((state) => {
    const currentUserId = state.auth?.user.id ?? null
    if (currentUserId && currentUserId !== lastUserId) {
      lastUserId = currentUserId
      // Pull manga list on sign-in
      pullMangaFromAniList()
      // Also backfill entry IDs for already-saved manga
      setTimeout(() => backfillMangaEntryIds(), 3000)
    } else if (!currentUserId && lastUserId) {
      // Signed out — clear in-memory caches
      lastUserId = null
      malToEntryId.clear()
      malToAniId.clear()
      malToTotalChapters.clear()
      malToStatus.clear()
    }
  })
}
