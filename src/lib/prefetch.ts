// Episode prefetch helpers. Called from Watch.tsx when the player crosses
// the 70% / 75% / 80% marks (via onProgress).
//
// Why each tier:
//   - 70%: warm the AniSkip query so the next ep's skip data is ready
//   - 75%: prefetch the actual stream (the expensive decryption hop)
//   - 80%: optionally prime the HLS manifest so HLS.js renders frame 1 instantly
//
// All prefetches are idempotent + cancellable. We use a global AbortController
// keyed by `(malId, episode)` so changing episodes mid-prefetch aborts the
// in-flight work.

import { queryClient } from './queryClient'
import { getSkipTimes } from '../api/aniskip'
import {
  fetchAnidapInfo, fetchAnidapServers, fetchAnidapStream,
} from '../api/anidap'
import { getEpisodeInfoFromMal } from '../api/anilist'
import { getEpisodesByMalId } from '../api/anizip'
import { getAnimeById } from '../api/anime'
import { pickPreferredProvider } from './providers'

interface PrefetchArgs {
  malId: number
  anilistId: number | null
  anidapSlug: string                // already resolved
  nextEpisode: number
  audio: string                     // 'sub' | 'dub' | 'hsub'
  preferredServer: string           // 'auto' | 'yuki' | ...
  titles?: { english?: string | null; romaji?: string | null }
}

// Tracks the most recent (malId, ep) we kicked off, so a stale prefetch
// from a previous episode doesn't override a fresh one's results.
let inFlightKey: string | null = null
let inFlightController: AbortController | null = null

function makeKey(malId: number, ep: number) {
  return `${malId}:${ep}`
}

/**
 * Cancel any prefetch in flight. Safe to call repeatedly.
 */
export function cancelPrefetch(): void {
  if (inFlightController) {
    inFlightController.abort()
    inFlightController = null
  }
  inFlightKey = null
}

/**
 * Warm AniSkip data only. Cheap (~50ms, cached by AniSkip's CDN).
 * Trigger this at ~70% progress.
 */
export function prefetchSkipTimes(malId: number, ep: number): void {
  void queryClient.prefetchQuery({
    queryKey: ['aniskip', malId, ep],
    queryFn: () => getSkipTimes(malId, ep, 0),
    staleTime: 60 * 60 * 1000,
  })
}

/**
 * Prefetch the next episode's stream URL — the big win. Skips automatically
 * if we already have a recent result in the React Query cache, or if a
 * matching prefetch is already in flight.
 *
 * Stream URLs aren't cached by React Query (the decryption tokens are
 * time-bound), so we cache the result ourselves under a "prefetched" key
 * that Watch.tsx can consume on demand.
 */
export async function prefetchStream(args: PrefetchArgs): Promise<void> {
  const key = makeKey(args.malId, args.nextEpisode)
  if (inFlightKey === key) return                 // already prefetching this ep
  cancelPrefetch()
  inFlightKey = key
  const controller = new AbortController()
  inFlightController = controller

  try {
    // Step 1: get the server list for the next ep
    const serversRes = await fetchAnidapServers(
      args.anidapSlug, args.nextEpisode, args.anilistId,
      controller.signal,
      args.titles,
    )
    if (controller.signal.aborted) return
    const list = serversRes.providers
    if (list.length === 0) return

    // Step 2: pick the same audio + server combination the user has now
    const sameType = list.filter((p) => p.type === args.audio)
    const pick =
      pickPreferredProvider(sameType, args.preferredServer) ??
      pickPreferredProvider(list, args.preferredServer)
    if (!pick) return

    // Step 3: decrypt + store under the prefetched cache key
    const stream = await fetchAnidapStream(
      args.anidapSlug, args.nextEpisode, pick.name, pick.type,
      { anilistId: args.anilistId, signal: controller.signal, titles: args.titles },
    )
    if (controller.signal.aborted) return

    queryClient.setQueryData(
      ['prefetched-stream', args.malId, args.nextEpisode, pick.type, pick.name],
      { stream, providers: list, pickedProvider: pick },
    )
  } catch {
    // Silent — prefetch is best-effort.
  } finally {
    if (inFlightKey === key) {
      inFlightKey = null
      inFlightController = null
    }
  }
}

/**
 * Read a previously-prefetched stream if available. Returns null when nothing
 * was prefetched OR when the prefetched data is older than 30 seconds (anidap
 * tokens expire within a minute).
 */
export function takePrefetchedStream(
  malId: number,
  ep: number,
  audio: string,
  serverName?: string,
): ReturnType<typeof readPrefetched> | null {
  return readPrefetched(malId, ep, audio, serverName)
}

function readPrefetched(
  malId: number,
  ep: number,
  audio: string,
  serverName?: string,
) {
  // Find any matching prefetched entry for (malId, ep, audio). We don't pin
  // server because it might not match exactly when settings change.
  const cache = queryClient.getQueryCache()
  for (const q of cache.getAll()) {
    const key = q.queryKey as unknown[]
    if (
      key[0] !== 'prefetched-stream' ||
      key[1] !== malId ||
      key[2] !== ep
    ) continue
    if (key[3] !== audio) continue
    if (serverName && key[4] !== serverName) continue

    const updated = q.state.dataUpdatedAt
    if (Date.now() - updated > 30_000) continue // too old; token may be dead

    return q.state.data as {
      stream: Awaited<ReturnType<typeof fetchAnidapStream>>
      providers: Awaited<ReturnType<typeof fetchAnidapServers>>['providers']
      pickedProvider: { name: string; type: string }
    }
  }
  return null
}

/**
 * Remove any prefetched stream we stored for (malId, ep). Called once Watch.tsx
 * consumes the prefetched data so it doesn't sit in the cache stale.
 */
export function clearPrefetchedStream(malId: number, ep: number): void {
  const cache = queryClient.getQueryCache()
  for (const q of cache.getAll()) {
    const key = q.queryKey as unknown[]
    if (key[0] === 'prefetched-stream' && key[1] === malId && key[2] === ep) {
      queryClient.removeQueries({ queryKey: key })
    }
  }
}


// ─── Lightweight prefetches (used independently of the heavy stream prefetch) ─

/**
 * Pre-warm the anidap info lookup for an AniList ID. Cheap — one HTTP
 * round-trip. Used when the user hovers a "Watch" button on the details
 * page so the slug resolution is already done by the time they click.
 *
 * Idempotent — React Query dedupes identical in-flight requests.
 *
 * Module-level guard: if the upstream (anidap.se) is down and returns 500,
 * React Query will keep the error in its cache for `staleTime` (15 min).
 * But the prefetch useEffect on the Details page can still be re-entered
 * if the component re-renders for unrelated reasons (e.g. settings store
 * updates) — and each re-entry would have called fetchQuery and the
 * downstream `prefetchStream` chain, hammering the failing endpoint.
 * We short-circuit here so the slug resolution is attempted at most once
 * per anilistId per page-load. A page reload clears the Set and lets
 * the user retry naturally.
 */
const attemptedAnidapInfo = new Set<number>()
export function prefetchAnidapInfo(anilistId: number): void {
  if (attemptedAnidapInfo.has(anilistId)) return
  attemptedAnidapInfo.add(anilistId)
  void queryClient.prefetchQuery({
    queryKey: ['anidap', 'slug', anilistId],
    queryFn: async () => {
      const res = await fetchAnidapInfo(anilistId)
      return res.slug ?? 'unavailable'
    },
    staleTime: 15 * 60 * 1000,
  })
}

/**
 * Pre-warm JUST the server list for an episode (no stream/decryption).
 * Cheaper than prefetchStream — saves the ~1-2s round-trip when the
 * user clicks "next episode" if the stream wasn't deep-prefetched yet.
 *
 * Use case: fired at episode-mount so the next episode's servers are
 * always one cache-hit away.
 */
export function prefetchAnidapServers(
  anidapSlug: string,
  ep: number,
  anilistId: number | null,
  titles?: { english?: string | null; romaji?: string | null },
): void {
  // Skip if the slug resolution itself failed (slug === 'unavailable').
  // Calling fetchAnidapServers with an 'unavailable' slug would just
  // waste an HTTP round-trip on a 4xx that the backend already cached.
  if (!anidapSlug || anidapSlug === 'unavailable') return
  void queryClient.prefetchQuery({
    queryKey: ['anidap', 'servers', anidapSlug, ep],
    queryFn: () => fetchAnidapServers(anidapSlug, ep, anilistId, undefined, titles),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Pre-warm the AniList episode info query (malId → anilistId + metadata).
 * Fired on AnimeCard hover and NavbarSearchDropdown result hover so the
 * anilistId is cached before the user reaches the details page. Without
 * this, AnimeDetails → Watch waterfall pays a 200-500ms AniList round-trip.
 *
 * Safe: purely a client-side GraphQL query to AniList's public API.
 * No server-side scraper traffic, no rate-limit risk.
 *
 * Idempotent — deduped by malId via module-level Set.
 */
const attemptedEpInfo = new Set<number>()
export function prefetchAnimeEpInfo(malId: number): void {
  if (attemptedEpInfo.has(malId)) return
  attemptedEpInfo.add(malId)
  void queryClient.prefetchQuery({
    queryKey: ['anime', malId, 'episodeInfo'],
    queryFn: () => getEpisodeInfoFromMal(malId),
    staleTime: 30 * 60 * 1000,
  })
}

/**
 * Pre-warm the full anime details + episode list for a card hover.
 * By the time the user clicks, the details page can render instantly
 * without waiting on Jikan/AniZip cold fetches.
 */
const attemptedAnime = new Set<number>()
export function prefetchAnimeDetails(anime: { mal_id: number; episodes: number | null }): void {
  const malId = anime.mal_id
  if (attemptedAnime.has(malId)) return
  attemptedAnime.add(malId)

  // Prefetch full Jikan/AniList details
  void queryClient.prefetchQuery({
    queryKey: ['anime', malId],
    queryFn: () => getAnimeById(malId),
    staleTime: 60 * 60 * 1000,
  })

  // Prefetch AniZip episodes using the Jikan episode count as a cap.
  // We use the same query key shape as AnimeDetails.tsx.
  if (anime.episodes != null && anime.episodes > 0) {
    void queryClient.prefetchQuery({
      queryKey: ['anime', malId, 'episodes', anime.episodes, null],
      queryFn: () => getEpisodesByMalId(malId, { cap: anime.episodes, airedThrough: null }),
      staleTime: 60 * 60 * 1000,
    })
  }
}
