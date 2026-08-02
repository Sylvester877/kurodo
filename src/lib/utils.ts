import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatScore(score: number | null): string {
  if (score === null) return 'N/A'
  return score.toFixed(1)
}

/**
 * Fail-fast wrapper: reject a promise after `ms` so a slow/hung upstream
 * (Jikan, AniList, anidap…) never leaves a page spinning for 20+ seconds.
 * Shared by AnimeDetails and Watch.
 */
export function withTimeout<T>(promise: Promise<T>, label: string, ms = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise
      .then((value) => { clearTimeout(timer); resolve(value) })
      .catch((err) => { clearTimeout(timer); reject(err) })
  })
}

export function formatMembers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return count.toString()
}

export function truncateText(text: string | null, maxLength: number): string {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength).trimEnd() + '...'
}

/**
 * Translate raw axios / fetch errors into something a human can act on.
 * "Request failed with status code 500" → "Server error — try another server"
 */
export function friendlyError(err: unknown): string {
  if (!err) return 'Something went wrong.'

  const raw = err instanceof Error ? err.message
            : typeof err === 'string' ? err
            : String(err)

  // ── 1. Specific upstream failures from our router (most informative) ──
  // Format: "All scrapers failed: anidap: <reason> | miruro: <reason>"
  if (/all scrapers failed/i.test(raw)) {
    return 'Both stream sources are down right now. Try a different episode or come back later.'
  }
  if (/no servers available/i.test(raw)) {
    return 'No servers available for this episode yet. Try another episode or a different anime.'
  }
  if (/no stream from any source/i.test(raw)) {
    return 'No playable stream found from any source for this episode.'
  }

  // ── 2. Axios HTTP statuses ──
  const statusMatch = raw.match(/status code (\d{3})/i)
  if (statusMatch) {
    const code = Number(statusMatch[1])
    if (code === 429) return 'Too many requests — please wait a moment and retry.'
    if (code === 403) return 'Blocked by the source — try a different server.'
    if (code === 404) return 'Stream not found — this episode may not be available.'
    if (code === 408 || code === 504) return 'Source timed out — try a different server.'
    if (code === 502) return 'Upstream source is unreachable. Try another anime.'
    if (code >= 500) return 'The streaming source is having a bad moment. Try another server.'
    if (code >= 400) return `Request rejected (${code}). Try refreshing or a different server.`
  }

  // ── 3. Real client-side connectivity issues — be specific ──
  // Only flag "your connection" when navigator says we're actually offline.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'You appear to be offline. Reconnect and retry.'
  }
  if (/network error|err_network|err_internet_disconnected/i.test(raw)) {
    return 'Network error — check your connection and retry.'
  }
  if (/timeout/i.test(raw)) {
    return 'Request timed out. Try another server.'
  }
  if (/fetcherror|fetch error/i.test(raw)) {
    // This is the package's wrapped error — usually means the scraper
    // couldn't reach its upstream, NOT your machine.
    return 'The stream source isn\'t responding. Try another server or a different anime.'
  }

  // ── 4. Other known patterns ──
  if (/no stream|not found/i.test(raw)) {
    return 'No playable stream found for this episode.'
  }
  if (/token|decrypt|aes|gcm/i.test(raw)) {
    return 'Decryption failed — the source may have updated. Try refreshing.'
  }

  // Truncate very long messages so the UI doesn't blow up
  return raw.length > 140 ? raw.slice(0, 140) + '…' : raw
}

/**
 * Safe base64 encode that works in both browser and Node (SSR/test).
 * Falls back to Buffer when btoa is unavailable.
 */
export function safeBase64(input: string): string {
  if (typeof btoa === 'function') {
    return btoa(input)
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64')
  }
  throw new Error('No base64 encoder available')
}

/**
 * Get the best-available cover/poster image URL.
 * Jikan's `large_image_url` is 400×600 — fine for cards but soft on retina.
 * We can squeeze more out of the same MAL CDN by stripping the `l` suffix
 * (returns 225×338 default) — no, that's *smaller*. The real trick:
 *   • MAL stores resized variants only at 41px, 225px, 400px widths.
 *   • For *truly* large hero artwork, prefer the trailer's
 *     `maximum_image_url` (1280px YouTube thumbnail) when available.
 *   • Fall back to MAL's `large_image_url` (400×600 webp ≈ 30 KB).
 */
export function getImageUrl(anime: {
  images: { webp: { large_image_url: string }; jpg: { large_image_url: string } }
}): string {
  return anime.images.webp.large_image_url || anime.images.jpg.large_image_url
}

export function getSmallImageUrl(anime: {
  images: { webp: { small_image_url: string }; jpg: { small_image_url: string } }
}): string {
  return anime.images.webp.small_image_url || anime.images.jpg.small_image_url
}

/**
 * Best HERO/BANNER image — wide cinematic shot for the home hero or detail
 * banner. Prefers:
 *   1. YouTube trailer's maximum thumbnail (1280×720 — looks great)
 *   2. MAL's webp large cover (fallback portrait crop)
 */
export function getHeroImageUrl(anime: {
  trailer?: {
    images?: {
      maximum_image_url?: string | null
      large_image_url?: string | null
    } | null
  } | null
  images: { webp: { large_image_url: string }; jpg: { large_image_url: string } }
}): string {
  return (
    anime.trailer?.images?.maximum_image_url ||
    anime.trailer?.images?.large_image_url ||
    getImageUrl(anime)
  )
}

/**
 * Build a `srcset` for retina displays. Browser picks the best size.
 * Works for any MAL CDN URL (the suffix-stripping convention is stable).
 */
/**
 * Pick the best title for display based on the user's titleLang preference.
 * Falls back gracefully when the requested language is missing.
 */
export function pickTitle(
  anime: { title: string; title_english?: string | null; title_japanese?: string | null },
  lang: 'english' | 'romaji' | 'native' = 'english',
): string {
  switch (lang) {
    case 'english': return anime.title_english || anime.title
    case 'romaji':  return anime.title || anime.title_english || ''
    case 'native':  return anime.title_japanese || anime.title_english || anime.title
  }
}

// ── Backend origin for packaged Electron ────────────────────────────
// In development Vite proxies /api and /img to the Express backend, so
// relative URLs work. In the packaged Electron app the frontend is still
// served from http://localhost:5173, but using an absolute origin makes
// image/API URLs robust if the page is ever loaded from file:// or a
// different context. window.__KURODO_BACKEND_ORIGIN__ is injected by the
// Electron preload; otherwise fall back to the current origin.
export function getBackendOrigin(): string {
  if (typeof window === 'undefined') return ''
  // Electron preload exposes the backend origin directly.
  const electron = (window as { electronAPI?: { backendOrigin?: string } }).electronAPI
  if (electron?.backendOrigin) return electron.backendOrigin
  // Fallback: when the page is served from the backend itself (packaged app),
  // the current origin is the backend. In dev (localhost:3000) Vite proxies
  // /api and /img, so an empty string keeps relative URLs working.
  return window.location.origin.includes('localhost:5173')
    ? window.location.origin
    : ''
}

// ── CDN hosts with CORS headers that don't need the /img proxy ──
// Pre-computed array from Set so canDirectUrl() doesn't spread on every call.
const DIRECT_CDN_LIST = [
  'cdn.myanimelist.net', // MAL CDN — sends CORS *
  'artworks.thetvdb.com', // TVDB CDN — sends CORS *
  'image.tmdb.org',      // TMDB images — sends CORS *
]

function canDirectUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return DIRECT_CDN_LIST.some((h) => host.includes(h))
  } catch { return false }
}

/**
 * Wrap an image URL through our /img proxy so it gets 24h browser cache,
 * service-worker caching, and graceful fallback on upstream 403/404.
 * Skips the proxy for known CORS-enabled CDNs (AniList, MAL, TVDB, TMDB)
 * — serving images directly from the CDN eliminates the server round-trip.
 */
export function proxifyImgUrl(url: string): string {
  if (!url) return url
  if (url.startsWith('http') && canDirectUrl(url)) return url
  if (!url.startsWith('http')) return url
  const origin = getBackendOrigin()
  return `${origin}/img?url=${encodeURIComponent(url)}`
}

/**
 * Build a fallback chain through the /img proxy for AniList images.
 * The proxy tries extraLarge → large → medium in order, returning the
 * first one that loads successfully. Falls back to a styled placeholder.
 *
 * Pass `label` so the placeholder shows the anime title instead of '?'.
 */
export function proxifyWithFallback(url: string, label?: string): string {
  const origin = getBackendOrigin()
  if (!url) return `${origin}/img?url=&label=${encodeURIComponent(label || '?')}`
  if (!url.startsWith('http')) return url
  if (url.startsWith('/img')) return url

  // Fast path: known CORS CDNs don't need the proxy at all
  if (canDirectUrl(url)) return url

  // For AniList CDN URLs, build a multi-size fallback chain
  if (url.includes('anilist.co')) {
    const sizes: string[] = [url]
    // Generate smaller variants as fallbacks
    const large = url.replace(/\/extraLarge\//, '/large/')
    if (large !== url) sizes.push(large)
    const medium = url.replace(/\/(extraLarge|large)\//, '/medium/')
    if (medium !== url && medium !== large) sizes.push(medium)

    const params = sizes.map((u) => `url=${encodeURIComponent(u)}`).join('&')
    const labelParam = label ? `&label=${encodeURIComponent(label.slice(0, 24))}` : ''
    return `${origin}/img?${params}${labelParam}`
  }

  // Non-AniList URLs — single URL, with label for placeholder
  const labelParam = label ? `&label=${encodeURIComponent(label.slice(0, 24))}` : ''
  return `${origin}/img?url=${encodeURIComponent(url)}${labelParam}`
}

/**
 * Wrap every URL in a srcset string through the /img proxy.
 * Parses "url1 400w, url2 800w" → "/img?url=url1 400w, /img?url=url2 800w"
 */
export function proxifySrcSet(srcSet: string): string {
  if (!srcSet) return srcSet
  return srcSet.replace(
    /(https?:\/\/[^\s,]+)/g,
    (url) => proxifyImgUrl(url),
  )
}

/**
 * Build a `srcset` for retina displays. Browser picks the best density.
 *
 * Handles two CDN formats:
 *   • MAL:  https://cdn.myanimelist.net/images/anime/1079/138100l.webp
 *           → strip `l` suffix for 225w, keep `l` for 400w
 *   • AniList: https://s4.anilist.co/file/anilistcdn/media/anime/cover/extraLarge/bx123.jpg
 *              → swap /extraLarge/ → /large/ (460w) → /medium/ (230w)
 *
 * AniList's actual CDN sizes: medium≈230px, large≈460px, extraLarge=full upload.
 * MAL's only sizes are 225px (no suffix) and 400px (`l` suffix). Neither CDN
 * offers a true 2× retina variant, but the extra size tier still gives the
 * browser more to work with on hidpi screens.
 */
export function buildPosterSrcSet(largeUrl: string): string {
  if (!largeUrl) return largeUrl

  // ── AniList CDN ──────────────────────────────────────────────────
  if (largeUrl.includes('anilist.co')) {
    const parts: string[] = []

    // Medium variant (230w) — swap large|extraLarge → medium
    const medium = largeUrl.replace(/\/(large|extraLarge)\//, '/medium/')
    if (medium !== largeUrl) parts.push(`${medium} 230w`)

    // Large variant (460w) — swap extraLarge → large, or keep if already large
    const large = largeUrl.replace(/\/extraLarge\//, '/large/')
    if (large !== largeUrl) parts.push(`${large} 460w`)

    // extraLarge as the top tier; estimate ~690w (1.5× large) for hidpi
    if (largeUrl.includes('/extraLarge/')) parts.push(`${largeUrl} 690w`)
    else if (largeUrl.includes('/large/')) parts.push(`${largeUrl} 460w`)

    // Fallback: URL didn't contain large/extraLarge — return as-is
    if (parts.length === 0) return largeUrl

    return parts.join(', ')
  }

  // ── MAL CDN ─────────────────────────────────────────────────────
  if (largeUrl.includes('cdn.myanimelist.net')) {
    const base = largeUrl.replace(/l\.(webp|jpg|png)$/, '.$1')
    if (base === largeUrl) return largeUrl
    return `${base} 225w, ${largeUrl} 400w`
  }

  // Unknown CDN — return as-is; browser uses it at 1×
  return largeUrl
}

/**
 * Safe localStorage.setItem wrapper that warns the user on failure.
 * When localStorage is full or blocked (private browsing, corporate
 * lockdown), silently swallowing the error leaves the user confused
 * about why their settings don't persist. This helper shows a toast
 * so they know something went wrong.
 */
export function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Dynamically import toast to avoid circular dependency.
    // Debounce via module-level flag so we only warn once per session.
    if (_localStorageWarned) return
    _localStorageWarned = true
    import('../components/Toaster').then(({ toast }) => {
      toast('Could not save setting — localStorage may be full or disabled', 'info')
    }).catch(() => {})
  }
}
let _localStorageWarned = false