import { QueryClient } from '@tanstack/react-query'

/**
 * App-wide React Query client.
 * Aggressive caching so re-renders / re-navigation never hit the network twice.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered "fresh" for 10 minutes — no refetch on remount within
      // that window. Anime catalog data barely changes hour-to-hour.
      staleTime: 10 * 60 * 1000,
      // Keep unused query data in memory for 1 hour after the last component
      // using it unmounts — instant back-nav.
      gcTime: 60 * 60 * 1000,
      // The AniList client already retries 429/5xx internally with proper
      // backoff, so don't double-retry a rate-limit error (that just hammers
      // the API again). Retry everything else once.
      retry: (failureCount, error) => {
        if (error instanceof Error && error.name === 'AniListRateLimitError') return false
        return failureCount < 1
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
    },
  },
})

/**
 * Lightweight persistence — we re-hydrate the top-level "feed" queries from
 * localStorage on app boot so second visits paint INSTANTLY with last week's
 * data (then quietly refetch in the background).
 */
const STORAGE_KEY = 'kurodo-rq-cache'
const PERSIST_MAX_AGE = 6 * 60 * 60 * 1000 // 6h

interface Snapshot {
  at: number
  entries: Array<[unknown[], unknown]>
}

export function loadPersistedCache(): void {
  if (typeof window === 'undefined') return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    // Hard size cap — if the snapshot is larger than 2MB it's probably
    // corrupted or has accumulated junk; nuke it rather than blocking
    // the main thread parsing JSON for half a second.
    if (raw.length > 2_000_000) {
      console.warn('[queryClient] cache too big (' + raw.length + ' bytes) — clearing')
      localStorage.removeItem(STORAGE_KEY)
      import('../components/Toaster').then(({ toast }) => toast('Cache reset due to size — data will re-fetch.', 'info', 3000)).catch(() => {})
      return
    }
    const snap = JSON.parse(raw) as Snapshot
    if (!snap || typeof snap.at !== 'number' || !Array.isArray(snap.entries)) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    if (Date.now() - snap.at > PERSIST_MAX_AGE) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    for (const [key, data] of snap.entries) {
      try {
        queryClient.setQueryData(key as readonly unknown[], data)
      } catch {
        /* skip individual bad entries; don't take down the whole hydrate */
      }
    }
  } catch (e) {
    // Always nuke on parse failure — a corrupt cache will keep crashing
    // until manually cleared otherwise.
    console.warn('[queryClient] cache parse failed, clearing:', e)
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    import('../components/Toaster').then(({ toast }) => toast('Cache reset due to corruption — data will re-fetch.', 'info', 3000)).catch(() => {})
  }
}

/** Public reset — called from ErrorBoundary's "Reset app data" button. */
export function clearPersistedCache(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  queryClient.clear()
}

let saveTimer: number | undefined
export function startPersistence(): void {
  if (typeof window === 'undefined') return

  const save = () => {
    try {
      const entries: Array<[unknown[], unknown]> = []
      for (const q of queryClient.getQueryCache().getAll()) {
        // Only persist queries flagged with persist:true in their meta
        if (q.meta?.persist && q.state.data !== undefined) {
          entries.push([q.queryKey as unknown[], q.state.data])
        }
      }
      const snap: Snapshot = { at: Date.now(), entries }
      const json = JSON.stringify(snap)
      // Soft cap at 1.5 MB to avoid breaking localStorage on huge feeds
      if (json.length < 1_500_000) localStorage.setItem(STORAGE_KEY, json)
    } catch {
      /* quota — silently skip */
    }
  }

  // Debounced save on every cache mutation
  queryClient.getQueryCache().subscribe(() => {
    if (saveTimer) window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(save, 1500)
  })

  // Save on page hide so we never lose the latest snapshot
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save()
  })
}
