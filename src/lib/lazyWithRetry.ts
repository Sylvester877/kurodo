import { lazy, type ComponentType } from 'react'

/** Retry-able lazy() that auto-recovers from stale chunks after a Vite rebuild.
 *
 *  Vite renames chunks on every build (e.g. AnimeDetails-OLDHASH.js →
 *  AnimeDetails-NEWHASH.js). If a user had the app open during a rebuild,
 *  their cached index.html still references the old chunk names — which no
 *  longer exist on the server. No amount of retrying or SW-cache-clearing
 *  can fix this: the filename is baked into the bundle.
 *
 *  Strategy:
 *    1. Try the import once.
 *    2. If it fails, wait 100ms (clears negative DNS/network caches) and
 *       retry — catches transient Electron network-stack hiccups.
 *    3. If both fail, auto hard-reload the page. This fetches the current
 *       index.html which references the new chunk names.
 *
 *  Guard against infinite reload loops via sessionStorage (not URL params,
 *  so ErrorBoundary's own hard-reload button still works). If we already
 *  reloaded once this session, throw to let ErrorBoundary catch it. */
// Using `ComponentType<any>` rather than `unknown` lets the helper wrap
// components with typed props (e.g. VideoPlayer) as well as page components.
export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() => {
    return importer().then((res) => {
      // Successful import: clear the auto-recovery guard so that a later
      // chunk failure in the same session is still allowed one retry cycle.
      if (typeof window !== 'undefined') {
        try { sessionStorage.removeItem('kurodo-reloaded') } catch { /* ignore */ }
      }
      return res
    }).catch((err) => {
      console.warn('[lazyWithRetry] chunk load failed on first attempt, retrying in 100ms…', String(err).slice(0, 80))
      // Small delay clears negative DNS/network caches before retrying
      return new Promise<{ default: T }>((resolve, reject) => setTimeout(() => {
        importer().then(resolve, reject)
      }, 100)).catch((err2) => {
        console.error('[lazyWithRetry] chunk load failed on retry, triggering hard reload…', String(err2).slice(0, 80))
        // Infinite-loop guard: if we already reloaded once this session, give up
        if (typeof window !== 'undefined' && sessionStorage.getItem('kurodo-reloaded')) {
          console.error('[lazyWithRetry] already reloaded once this session — giving up')
          throw err2
        }
        // Auto hard-reload: clear SW caches and force a fresh page load
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('kurodo-reloaded', '1')
          if ('caches' in window) {
            caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {})
          }
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {})
          }
          // Small delay so the cache nukes have a chance to fire
          setTimeout(async () => {
            // In Electron, clear the renderer cache before reloading so the
            // new build's chunks are guaranteed fresh (mirrors ErrorBoundary).
            if (window.electronAPI?.clearCache) {
              await Promise.race([
                window.electronAPI.clearCache().catch(() => {}),
                new Promise((_, reject) => setTimeout(() => reject(new Error('clearCache timeout')), 1000)),
              ]).catch(() => {})
            }
            window.location.assign('/?cb=' + Date.now())
          }, 300)
        }
        // Safety net: if the page reload somehow fails (e.g. blocked by
        // browser policy), throw after 4s so the ErrorBoundary can take over
        // instead of the user being stuck on a permanent spinner.
        return Promise.race([
          new Promise<{ default: T }>(() => {}),
          new Promise<{ default: T }>((_, reject) => setTimeout(() => reject(err2), 4000)),
        ])
      })
    })
  })
}
