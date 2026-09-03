/**
 * Route preloaders — start fetching a lazy chunk on `mouseover` / `focus`
 * so the JS is already cached by the time the user actually clicks.
 *
 * Without this, every link click that targets a lazy route triggers a
 * fresh network request which can stall the navigation for hundreds of
 * milliseconds on slow connections (or even minutes if the chunk has
 * been evicted from the SW cache).
 *
 * Each preloader is wrapped in a `.catch` so a network failure here
 * never bubbles up — the user can still click the link and the regular
 * Suspense loader takes over.
 */

const noop = () => Promise.resolve()

export const preloaders = {
  home:        () => import('../pages/Home').catch(noop),
  browse:      () => import('../pages/Browse').catch(noop),
  search:      () => import('../pages/Search').catch(noop),
  watchlist:   () => import('../pages/WatchList').catch(noop),
  schedule:    () => import('../pages/Schedule').catch(noop),
  profile:     () => import('../pages/Profile').catch(noop),
  settings:    () => import('../pages/Settings').catch(noop),
  animeDetails: () => import('../pages/AnimeDetails').catch(noop),
  watch:       () => import('../pages/Watch').catch(noop),
}

/**
 * Map a route path to its preloader. Returns a no-op when no match —
 * safe to attach to any link without special-casing.
 */
export function preloaderForPath(path: string): () => Promise<unknown> {
  if (path === '/') return preloaders.home
  if (path === '/browse' || path.startsWith('/browse?')) return preloaders.browse
  if (path === '/search' || path.startsWith('/search?')) return preloaders.search
  if (path === '/watchlist') return preloaders.watchlist
  if (path === '/schedule') return preloaders.schedule
  if (path === '/profile') return preloaders.profile
  if (path === '/settings') return preloaders.settings
  if (path.startsWith('/anime/')) return preloaders.animeDetails
  if (path.startsWith('/watch/')) return preloaders.watch
  return noop
}

/**
 * Convenience: handlers you can spread directly onto a <Link> to enable
 * preloading on every interaction kind (hover, focus, touch).
 *
 *   <Link to="/browse" {...preloadHandlers('/browse')}>Browse</Link>
 */
export function preloadHandlers(path: string) {
  const fn = preloaderForPath(path)
  let fired = false
  const fire = () => {
    if (fired) return
    fired = true
    fn()
  }
  return {
    onMouseEnter: fire,
    onFocus: fire,
    onTouchStart: fire,
  }
}
