import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, CheckCircle2, AlertCircle, Copy, RefreshCw } from 'lucide-react'
import {
  parseCodeFromQuery,
  parseTokenFromHash,
  exchangeCodeForToken,
  AniListExchangeError,
  getLoginUrl,
  setClientSecret,
} from '../api/anilistAuth'
import { useAuthStore } from '../store/useAuthStore'
import { toast } from '../components/Toaster'
import { useTitle } from '../hooks/useTitle'
import { getBackendOrigin } from '../lib/utils'

export default function AuthCallback() {
  const navigate = useNavigate()
  const setAuthFromToken = useAuthStore((s) => s.setAuthFromToken)
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending')
  const [msg, setMsg] = useState('Completing sign-in…')
  const [debug, setDebug] = useState<unknown>(null)
  const [upstream, setUpstream] = useState<number | undefined>()

  useTitle('Signing in')

  // Guard against React Strict Mode double-mount: in development the effect
  // fires twice, but the first run strips the token from the URL hash, so
  // the second run sees no payload and spuriously reports an error.
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    // ─── 1. Implicit flow: token comes back in the URL fragment ───
    // This is the no-setup default. If we find #access_token=… in the
    // URL we use it directly — no server round-trip.
    const fromHash = parseTokenFromHash()
    if (fromHash) {
      if ('error' in fromHash) {
        setState('error')
        if (/unsupported_grant_type/i.test(fromHash.error)) {
          setMsg(fromHash.error)
          setUpstream(400)
        } else {
          setMsg(fromHash.error)
        }
        return
      }
      // Extract OAuth state BEFORE clearing the URL — needed for cross-browser token relay.
      // In the implicit flow, AniList returns `state` in the URL FRAGMENT (#), NOT the
      // query string (?). We check both: fragment first (implicit flow), then query string
      // (auth-code flow fallback) so we never send an empty state to the relay endpoint.
      const fragmentParams = new URLSearchParams(window.location.hash.slice(1))
      const oauthState = fragmentParams.get('state') || new URLSearchParams(window.location.search).get('state') || ''
      // Strip the token from the visible URL ASAP for security hygiene.
      window.history.replaceState(null, '', '/auth/callback')

      const isElectron = !!(window as any).electronAPI?.isElectron
      if (!isElectron) {
        // Running in external browser — relay token back to the Electron app
        fetch(`${getBackendOrigin()}/api/anilist/relay-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: fromHash.token, expiresIn: fromHash.expiresIn, state: oauthState }),
        }).catch(() => {})
        setState('ok')
        setMsg('Sign-in successful! You can close this tab and return to the app.')
        return
      }

      setAuthFromToken(fromHash.token, fromHash.expiresIn)
        .then(() => {
          setState('ok')
          toast.success('Signed in with AniList')
          setTimeout(() => navigate('/', { replace: true }), 600)
        })
        .catch((e: unknown) => {
          setState('error')
          setMsg(e instanceof Error ? e.message : 'Failed to verify token with AniList.')
        })
      return
    }

    // ─── 2. Auth-code flow: ?code= in the query string ───
    // Used when the user opted into the advanced confidential-client
    // setup. Requires backend ANILIST_CLIENT_SECRET to be configured.
    const parsed = parseCodeFromQuery()
    if (!parsed) {
      setState('error')
      setMsg(
        'No sign-in payload received from AniList. The popup may have been ' +
        'closed too early, or the redirect URL in your AniList client doesn\'t ' +
        'match this site\'s origin.',
      )
      return
    }
    if ('error' in parsed) {
      setState('error')
      if (/unsupported_grant_type/i.test(parsed.error)) {
        setMsg(parsed.error)
        setUpstream(400)
      } else {
        setMsg(parsed.error)
      }
      return
    }
    // Extract OAuth state BEFORE clearing the URL — check both fragment (implicit)
    // and query string (auth-code flow). In auth-code flow, AniList puts `state` in
    // the query string, but we check the fragment too as a safety net.
    const fragmentParams2 = new URLSearchParams(window.location.hash.slice(1))
    const oauthState = fragmentParams2.get('state') || new URLSearchParams(window.location.search).get('state') || ''
    window.history.replaceState(null, '', '/auth/callback')

    const relayIfExternal = (token: string, expiresIn: number) => {
      const isElectron = !!(window as any).electronAPI?.isElectron
      if (!isElectron) {
        fetch(`${getBackendOrigin()}/api/anilist/relay-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, expiresIn, state: oauthState }),
        }).catch(() => {})
        setState('ok')
        setMsg('Sign-in successful! You can close this tab and return to the app.')
        return true
      }
      return false
    }

    exchangeCodeForToken(parsed.code)
      .then(({ token, expiresIn }) => {
        if (relayIfExternal(token, expiresIn)) return
        return setAuthFromToken(token, expiresIn)
      })
      .then(() => {
        if (!(window as any).electronAPI?.isElectron) return // already handled above
        setState('ok')
        toast.success('Signed in with AniList')
        setTimeout(() => navigate('/', { replace: true }), 600)
      })
      .catch((e: unknown) => {
        setState('error')
        if (e instanceof AniListExchangeError) {
          setMsg(e.message)
          setUpstream(e.upstream)
          setDebug(e.debug)
        } else if (e instanceof Error) {
          setMsg(e.message)
        } else {
          setMsg('Failed to verify your AniList account.')
        }
      })
  }, [navigate, setAuthFromToken])

  const copyDebug = () => {
    const text = JSON.stringify({ msg, upstream, debug }, null, 2)
    navigator.clipboard.writeText(text)
    toast.success('Debug info copied')
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 py-12">
      <div className="glass-card rounded-2xl p-8 max-w-xl w-full">
        {state === 'pending' && (
          <div className="text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm text-white/80">{msg}</p>
          </div>
        )}

        {state === 'ok' && (
          <div className="text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm text-white font-semibold">Signed in!</p>
            <p className="text-xs text-muted-foreground mt-1">{msg}</p>
          </div>
        )}

        {state === 'error' && (
          <>
            <div className="text-center mb-6">
              <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-white font-semibold mb-1">Sign-in failed</p>
              <p className="text-xs text-white/70">{msg}</p>
              {upstream != null && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  AniList HTTP status: {upstream}
                </p>
              )}
            </div>

            {/* Most-common fixes — surfaced inline so the user doesn't
                have to guess. We pattern-match the message to pick the
                most-likely hint. */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 mb-4 text-xs">
              <div className="font-semibold text-white mb-2">Likely causes:</div>
              <ul className="space-y-1.5 text-white/70 list-disc pl-4">
                {/redirect_uri|invalid.+redirect/i.test(msg) && (
                  <li>
                    The redirect URL in your AniList client settings must
                    EXACTLY match{' '}
                    <code className="text-primary">
                      {window.location.origin}/auth/callback
                    </code>{' '}
                    (no trailing slash, http not https for localhost).
                  </li>
                )}
                {/client|secret|unauthorized|invalid_client/i.test(msg) && (
                  <li>
                    Your <code className="text-primary">ANILIST_CLIENT_SECRET</code>{' '}
                    in <code>.env.local</code> doesn't match the one shown on{' '}
                    <a
                      href="https://anilist.co/settings/developer"
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      anilist.co/settings/developer
                    </a>
                    . Restart the app (<code>npm start</code>) after editing.
                  </li>
                )}
                {/grant_type|unsupported/i.test(msg) && (
                  <li>
                    Your AniList client is <strong>Confidential</strong>, not
                    Public. Confidential clients reject the implicit flow.
                    Either switch your client to{' '}
                    <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer" className="text-primary underline">Public</a>{' '}
                    on AniList, or{' '}
                    <button onClick={() => { navigate('/settings'); }} className="text-primary underline">add your Client Secret</button>{' '}
                    in the sign-in setup for auth-code flow.
                  </li>
                )}
                {/not configured|missing/i.test(msg) && (
                  <li>
                    Add both <code className="text-primary">VITE_ANILIST_CLIENT_ID</code>{' '}
                    and <code className="text-primary">ANILIST_CLIENT_SECRET</code>{' '}
                    to your <code>.env.local</code>, then{' '}
                    <strong>restart the dev server</strong>. Env changes
                    don't hot-reload.
                  </li>
                )}
                {/network|ECONN|timeout/i.test(msg) && (
                  <li>
                    The backend couldn't reach anilist.co. Check your
                    network and any proxy/VPN settings.
                  </li>
                )}
                {/* Always show this as a fallback. */}
                <li>
                  Check the backend terminal for a{' '}
                  <code className="text-primary">[anilist/exchange]</code>{' '}
                  log line — it shows AniList's exact reply.
                </li>
              </ul>
            </div>

            {debug != null && (
              <details className="rounded-xl bg-black/40 border border-white/10 p-3 mb-4 text-[11px]">
                <summary className="cursor-pointer text-white/70 font-semibold flex items-center justify-between">
                  <span>Server debug payload</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      copyDebug()
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px]"
                  >
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </summary>
                <pre className="mt-2 overflow-x-auto text-white/60">
                  {JSON.stringify(debug, null, 2)}
                </pre>
              </details>
            )}

            {/* Implicit flow fallback — when auth-code fails (e.g. public client),
                offer a one-click retry using the implicit flow. */}
            {/unsupported_grant_type/i.test(msg) && (
              <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4 mb-4">
                <p className="text-xs text-amber-300/90 mb-3">
                  Your AniList client may be <strong>Public</strong> (no Client Secret).
                  Public clients must use the implicit flow.
                </p>
                <button
                  onClick={() => {
                    setClientSecret(null)
                    const url = getLoginUrl({ flow: 'token' })
                    if (url) window.location.href = url
                    else toast.error('Failed to build authorize URL')
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm font-semibold transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  Retry with implicit flow
                </button>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => navigate('/admin', { replace: true })}
                className="flex-1 px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-medium hover:bg-white/20"
              >
                Open auth debug
              </button>
              <button
                onClick={() => navigate('/', { replace: true })}
                className="flex-1 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
              >
                Go home
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
