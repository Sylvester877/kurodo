import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LogIn, LogOut, RefreshCw, User, AlertCircle, BarChart3, ExternalLink, Settings as SettingsIcon, Send, ArrowRight, Loader2 } from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'
import { getLoginUrl, getClientId, setClientId, getClientSecret, setClientSecret } from '../api/anilistAuth'
import { getBackendOrigin } from '../lib/utils'
import { pullFromAniList, flushAllActivity } from '../lib/sync'
import { toast } from './Toaster'
import { cn } from '../lib/utils'

// Pure helper outside component — avoids recreation on every render
const genState = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

export default function AccountMenu() {
  const auth = useAuthStore((s) => s.auth)
  const signOut = useAuthStore((s) => s.signOut)
  const setAuthFromToken = useAuthStore((s) => s.setAuthFromToken)
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [authDropdownOpen, setAuthDropdownOpen] = useState(false)
  const [clientIdInput, setClientIdInput] = useState('')
  const [clientSecretInput, setClientSecretInput] = useState('')
  const [showSecretInput, setShowSecretInput] = useState(false)
  const [pollingState, setPollingState] = useState<string | null>(null) // non-null = waiting for external browser auth
  const [directAuthUrl, setDirectAuthUrl] = useState<string | null>(null) // fallback link when popup blocked
  const authDdRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  // Close auth dropdown on outside click
  useEffect(() => {
    if (!authDropdownOpen) return
    const onClick = (e: MouseEvent) => {
      if (!authDdRef.current?.contains(e.target as Node)) setAuthDropdownOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [authDropdownOpen])

  const storedId = getClientId()
  const storedSecret = getClientSecret()

  // Cancel any active polling (used before starting new poll, on cancel, and on unmount)
  const cancelPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (safetyRef.current) { clearTimeout(safetyRef.current); safetyRef.current = null }
  }

  // ROOT UX: one click → browser opens → signs in → token relays back.
  // No forms inside the desktop app when a client id already exists
  // (stored in Electron's disk file or baked into the build).
  const startRelayLogin = () => {
    const state = genState()
    const url = getLoginUrl({ flow: 'auto', state })
    if (!url) {
      toast.error('Failed to build AniList authorize URL')
      return
    }
    // Clear any stale fallback link from previous attempts
    setDirectAuthUrl(null)
    // Clear any existing polling before starting a new one
    cancelPolling()

    // Open in external browser (Electron) or new tab (browser dev mode).
    // In non-Electron mode, some browsers block `window.open` — fall back to
    // a direct link the user can click.
    const isElectron = !!(window as any).electronAPI?.isElectron
    if (isElectron) {
      setAuthDropdownOpen(false)
      // Route through our own /login gate in the user's default browser: it
      // carries the relay state (so /auth/callback hands the token back to
      // this poller) and the client id (the external browser has no access
      // to Electron's stored credentials).
      const cid = getClientId() || ''
      ;(window as any).electronAPI.openExternal(
        `${window.location.origin}/login?state=${encodeURIComponent(state)}${cid ? `&cid=${encodeURIComponent(cid)}` : ''}`,
      )
    } else {
      const popup = window.open(url, '_blank', 'noopener,noreferrer')
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        // Popup blocked — keep the dropdown open and show a clickable link.
        setDirectAuthUrl(url)
        toast.info('Pop-up blocked! Click the link below to sign in.', 8000)
      } else {
        setAuthDropdownOpen(false)
        setDirectAuthUrl(null)
      }
    }

    // Start polling for the relayed token
    setPollingState(state)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${getBackendOrigin()}/api/anilist/relay-token?state=${encodeURIComponent(state)}`)
        const json = await res.json()
        if (json.ok && json.data) {
          // Got the token from external browser!
          cancelPolling()
          setPollingState(null)
          await setAuthFromToken(json.data.token, json.data.expiresIn)
          toast.success('Signed in with AniList')
        }
      } catch { /* server not ready yet — keep polling */ }
    }, 1000)

    // Safety timeout: stop polling after 3 min
    safetyRef.current = setTimeout(() => {
      if (pollRef.current) {
        cancelPolling()
        setPollingState(null)
        toast.info('Sign-in timed out. Try again.')
      }
    }, 180000)
  }

  // Form submit: validate the pasted id, persist, then run the same flow.
  const saveAndLogin = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const cleaned = clientIdInput.trim()
    if (!cleaned || !/^\d+$/.test(cleaned)) {
      toast.error('Client ID should be a number like 42167')
      return
    }
    setClientId(cleaned)
    // Persist the secret if the user supplied one.
    if (clientSecretInput.trim()) setClientSecret(clientSecretInput.trim())
    else setClientSecret(null)
    startRelayLogin()
  }

  // Clean up polling on unmount
  useEffect(() => () => { cancelPolling() }, [])

  const resync = async () => {
    setSyncing(true)
    await pullFromAniList()
    setSyncing(false)
    setOpen(false)
  }

  // ─── Not signed in: Sign in + Settings ───
  if (!auth) {
    return (
      <>
        <div className="hidden sm:flex items-center gap-1.5">
          <Link
            to="/settings"
            aria-label="Settings"
            className="p-2 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
            title="Settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
          <div ref={authDdRef} className="relative">
            <button
              onClick={() => {
                if (authDropdownOpen) { setAuthDropdownOpen(false); return }
                // If already waiting for external browser auth, allow re-opening
                if (pollingState) { cancelPolling(); setPollingState(null); return }
                // One click → browser → signed in. The form only appears when
                // no client id exists anywhere (first-ever setup).
                if (getClientId()) { startRelayLogin(); return }
                setClientIdInput(storedId ?? '')
                setClientSecretInput(storedSecret ?? '')
                setDirectAuthUrl(null) // reset stale fallback link from previous attempt
                setAuthDropdownOpen(true)
              }}
              aria-label="Sign in with AniList"
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                pollingState
                  ? 'bg-white/10 text-white/70 cursor-pointer hover:bg-white/15'
                  : 'bg-primary text-white hover:bg-primary/90 shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.55)]',
              )}
              title={pollingState ? 'Waiting for browser sign-in… (click to cancel)' : 'Sign in with AniList'}
            >
              {pollingState ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Waiting…</span>
                </>
              ) : (
                <>
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Sign in</span>
                </>
              )}
            </button>

            {authDropdownOpen && (
              <div className="absolute top-full right-0 mt-2 w-80 rounded-xl glass-card overflow-hidden shadow-2xl z-50 border border-white/10 animate-[fadeInUp_0.15s_ease]">
                <form onSubmit={saveAndLogin} className="px-4 pt-4 pb-2">
                  <p className="text-xs font-semibold text-white mb-3">Sign in with AniList</p>
                  
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="anilist-client-id" className="block text-[10px] uppercase tracking-wider font-bold text-white/50 mb-1">
                        Client ID
                      </label>
                      <input
                        id="anilist-client-id"
                        name="anilist-client-id"
                        type="text"
                        inputMode="numeric"
                        pattern="\d*"
                        value={clientIdInput}
                        onChange={(e) => setClientIdInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="42167"
                        autoFocus
                        className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[13px] font-mono text-white placeholder:text-white/25 outline-none focus:border-primary focus:bg-black/60 transition-all"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="anilist-client-secret" className="text-[10px] uppercase tracking-wider font-bold text-white/50">
                          Client Secret <span className="text-white/30 font-normal normal-case">(optional)</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowSecretInput(!showSecretInput)}
                          className="text-[10px] text-white/40 hover:text-white/70 transition-colors"
                        >
                          {showSecretInput ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <input
                        id="anilist-client-secret"
                        name="anilist-client-secret"
                        type={showSecretInput ? 'text' : 'password'}
                        value={clientSecretInput}
                        onChange={(e) => setClientSecretInput(e.target.value)}
                        placeholder="Only needed for Confidential clients"
                        className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[13px] font-mono text-white placeholder:text-white/25 outline-none focus:border-amber-500/40 focus:bg-black/60 transition-all"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setAuthDropdownOpen(false)}
                      className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-white/60 hover:text-white/90 bg-white/[0.04] hover:bg-white/[0.08] border border-white/8 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!clientIdInput.trim()}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all',
                        clientIdInput.trim()
                          ? 'bg-primary text-white hover:bg-primary/90 shadow-[0_4px_16px_-6px_hsl(245,75%,60%,0.55)]'
                          : 'bg-white/5 text-white/30 cursor-not-allowed',
                      )}
                    >
                      Sign in
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <p className="text-[10px] text-white/35 mt-3 leading-relaxed">
                    Get your Client ID at{' '}
                    <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer" className="text-primary/80 hover:text-primary underline">
                      anilist.co/settings/developer
                    </a>
                    . Redirect URL: <code className="text-white/45">{window.location.origin}/auth/callback</code>
                  </p>

                  {/* Direct link fallback when popup is blocked (non-Electron mode) */}
                  {directAuthUrl && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <p className="text-[10px] text-amber-300/90 mb-2">
                        Pop-up was blocked by your browser. Click the link below to sign in:
                      </p>
                      <a
                        href={directAuthUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setDirectAuthUrl(null)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-[11px] font-semibold transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open AniList sign-in
                      </a>
                    </div>
                  )}
                </form>
              </div>
            )}
          </div>
        </div>
      </>
    )
  }

  // ─── Signed in: avatar with dropdown ───
  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className={cn(
          'flex items-center gap-2 rounded-full p-0.5 transition-all',
          open
            ? 'bg-primary/20 ring-2 ring-primary/40'
            : 'bg-white/5 hover:bg-white/10 ring-1 ring-white/10',
        )}
      >
        {auth.user.avatar ? (
          <img
            src={auth.user.avatar}
            alt={auth.user.name}
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-primary grid place-items-center">
            <User className="h-3.5 w-3.5 text-white" />
          </div>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 min-w-[220px] rounded-xl glass-card overflow-hidden shadow-2xl z-50">
          <div className="px-3 py-3 border-b border-white/5">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="text-sm font-semibold text-white truncate">{auth.user.name}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
              AniList #{auth.user.id}
            </p>
          </div>
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:bg-white/5 hover:text-white transition-colors"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            My dashboard
          </Link>
          <Link
            to="/activity"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Send className="h-3.5 w-3.5" />
            Activity
          </Link>
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:bg-white/5 hover:text-white transition-colors"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            Settings
          </Link>
          <a
            href={`https://anilist.co/user/${encodeURIComponent(auth.user.name)}`}
            target="_blank" rel="noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:bg-white/5 transition-colors"
            onClick={() => setOpen(false)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            AniList profile
          </a>
          <button
            onClick={resync}
            disabled={syncing}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Re-sync list'}
          </button>
          <button
            onClick={() => {
              flushAllActivity()
              setOpen(false)
              toast.info('Flushing pending activity now', 2500)
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white/80 hover:bg-white/5 transition-colors"
            title="Post any buffered activity to AniList immediately"
          >
            <Send className="h-3.5 w-3.5" />
            Flush pending now
          </button>
          <Link
            to="/admin"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-white/60 hover:bg-white/5 hover:text-white transition-colors"
            title="Diagnose sign-in / sync issues"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            Sign-in diagnostic
          </Link>
          <button
            onClick={() => { signOut(); setOpen(false); toast.info('Signed out') }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors border-t border-white/5"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
