import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RotateCcw, Home, Trash2, Copy } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Optional friendlier label for the boundary scope, e.g. "Watch page". */
  scope?: string
}
interface State {
  error: Error | null
  info: ErrorInfo | null
}

/**
 * Catches any uncaught render error below and shows a recovery UI
 * instead of a blank/black screen.
 *
 * Provides three escape hatches the user can try in order of cost:
 *   1. "Try again"       → reset boundary, attempt re-render
 *   2. "Go home"         → navigate to /, often resolves stuck-on-page bugs
 *   3. "Reset app data"  → wipes localStorage (query cache, settings, etc.)
 *                          and reloads. Last-ditch but always works.
 *
 * Also a "Copy diagnostics" button so the user can paste the stack +
 * useragent into a bug report.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack for the diagnostics dump.
    this.setState({ error, info })
    // Surface to the console so devs see something in DevTools too.
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.scope ? ' / ' + this.props.scope : ''}]`, error, info)
  }

  reset = () => this.setState({ error: null, info: null })

  goHome = () => {
    this.reset()
    window.location.assign('/')
  }

  /** Hard reload with cache-bust — bypasses stale service-worker cache
   *  that may be holding old chunk names after a Vite rebuild. */
  hardReload = async () => {
    // Reset the lazyWithRetry loop guard so a manual recovery is treated
    // as a fresh start, not a session that already failed auto-recovery.
    try { sessionStorage.removeItem('kurodo-reloaded') } catch { /* ignore */ }

    // In Electron, ask the main process to clear the renderer cache before
    // we reload. This is more reliable than the DOM caches API for file://
    // and custom protocol packaged builds.
    if (window.electronAPI?.clearCache) {
      try { await window.electronAPI.clearCache() } catch { /* ignore */ }
    }

    // Nuke service worker caches so the next load pulls fresh assets
    if ('caches' in window) {
      caches.keys().then((keys) => {
        keys.forEach((k) => caches.delete(k))
      }).catch(() => {})
    }
    // Unregister any active service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister())
      }).catch(() => {})
    }
    // Force a full page reload with a cache-bypass
    window.location.assign('/?cb=' + Date.now())
  }

  /** True when the error looks like a stale chunk (failed dynamic import). */
  isChunkError = () => {
    const error = this.state.error
    if (!error) return false
    const msg = error.message || ''
    const stack = error.stack || ''
    // Broaden detection: Vite, Rollup, Webpack, and Electron all emit
    // slightly different messages/names for failed dynamic imports.
    if (/dynamically imported module|dynamic import|importing a module script|loading chunk \d+|chunk load/i.test(msg)) {
      return true
    }
    if (error.name === 'ChunkLoadError' || /ChunkLoadError/i.test(stack)) {
      return true
    }
    // Electron-specific: a renderer network failure may surface as a
    // generic TypeError with the chunk URL in the stack.
    if (/\.js\?/i.test(stack) && /fetch|load|network|dynamically imported/i.test(msg)) {
      return true
    }
    return false
  }

  resetAppData = () => {
    try {
      // Targeted wipe — keep auth (so the user doesn't have to re-sign-in)
      // unless they explicitly nuke that too. Most "bad state" crashes
      // come from the React Query cache or watchlist persistence.
      const keepKeys = ['kurodo-anilist-auth']
      const saved: Record<string, string | null> = {}
      for (const k of keepKeys) saved[k] = localStorage.getItem(k)
      localStorage.clear()
      for (const k of keepKeys) {
        if (saved[k] != null) localStorage.setItem(k, saved[k]!)
      }
    } catch { /* ignore */ }
    window.location.assign('/')
  }

  copyDiagnostics = () => {
    const { error, info } = this.state
    const text = [
      `[Kurōdo crash report]`,
      `Time:  ${new Date().toISOString()}`,
      `Scope: ${this.props.scope || '(root)'}`,
      `URL:   ${typeof location !== 'undefined' ? location.href : '?'}`,
      `UA:    ${typeof navigator !== 'undefined' ? navigator.userAgent : '?'}`,
      ``,
      `Error: ${error?.name}: ${error?.message}`,
      ``,
      `Stack:`,
      error?.stack || '(no stack)',
      ``,
      `Component stack:`,
      info?.componentStack || '(no component stack)',
    ].join('\n')
    try {
      navigator.clipboard.writeText(text)
    } catch { /* ignore */ }
  }

  render() {
    if (!this.state.error) return this.props.children

    const e = this.state.error
    return (
      <div className="min-h-screen grid place-items-center p-6 bg-background text-white">
        <div className="max-w-lg w-full rounded-2xl border border-red-500/10 bg-card/85 p-6 shadow-lg shadow-red-500/5">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-xl bg-red-500/15 grid place-items-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-white">
                Something broke{this.props.scope ? ` in ${this.props.scope}` : ''}
              </h2>
              <p className="text-xs text-white/60 mt-0.5">
                The app caught the error so the rest of your session is safe.
                Try the actions below before reporting.
              </p>
            </div>
          </div>

          {/* Compact error message — full stack lives under the details */}
          <div className="rounded-lg bg-black/40 border border-white/5 p-3 mb-4 font-mono text-[11px] text-red-200/90 break-words">
            {e.name}: {e.message}
          </div>

          <details className="mb-5">
            <summary className="cursor-pointer text-[11px] text-white/50 hover:text-white/80 select-none">
              View stack trace
            </summary>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-black/60 border border-white/5 p-3 text-[10px] text-white/50 leading-relaxed whitespace-pre-wrap">
              {e.stack || '(no stack available)'}
            </pre>
          </details>

          {/* Recovery actions — ordered by cost (low → high) */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            {this.isChunkError() ? (
              <button
                onClick={this.hardReload}
                className="col-span-2 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-all shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.4)] hover:shadow-[0_8px_24px_-6px_hsl(245,75%,60%,0.55)] hover:-translate-y-0.5"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Hard reload (after update)
              </button>
            ) : (
              <>
                <button
                  onClick={this.reset}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-all shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.4)] hover:shadow-[0_8px_24px_-6px_hsl(245,75%,60%,0.55)] hover:-translate-y-0.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Try again
                </button>
                <button
                  onClick={this.goHome}
                  className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/8 text-white/85 text-xs font-bold hover:bg-white/15 border border-white/10 transition-colors"
                >
                  <Home className="h-3.5 w-3.5" /> Go home
                </button>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={this.copyDiagnostics}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/[0.04] text-white/70 text-xs font-semibold hover:bg-white/10 border border-white/8 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" /> Copy diagnostics
            </button>
            <button
              onClick={this.resetAppData}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-300 text-xs font-semibold hover:bg-red-500/20 border border-red-500/20 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Reset app data
            </button>
          </div>

          <p className="text-[10px] text-muted-foreground mt-3 text-center">
            "Reset app data" wipes the query cache, settings, and watchlist
            (your AniList sign-in is kept).
          </p>
        </div>
      </div>
    )
  }
}
