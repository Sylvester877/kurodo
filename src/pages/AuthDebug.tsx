import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, ExternalLink,
  Copy, LogIn, LogOut, Circle, RefreshCw,
} from 'lucide-react'
import {
  getClientId, loadAuth, getLoginUrl, fetchCurrentUser, fetchUserList,
  type AniListAuth,
} from '../api/anilistAuth'
import { useAuthStore } from '../store/useAuthStore'
import { useWatchListStore } from '../store/useWatchListStore'
import { useTitle } from '../hooks/useTitle'
import { cn } from '../lib/utils'

type Status = 'idle' | 'running' | 'ok' | 'fail'
interface Check {
  id: string; label: string; description: string
  status: Status; message?: string; detail?: string
}

const FAQ = [
  { symptom: 'Step 1 fails — CLIENT_ID missing',
    fix: 'Create .env.local with VITE_ANILIST_CLIENT_ID=<number>, restart npm run dev.' },
  { symptom: "AniList shows 'redirect_uri_mismatch'",
    fix: "On anilist.co/settings/developer, your client Redirect URL must match the URL shown in Step 4 EXACTLY (protocol + port included)." },
  { symptom: 'Step 5 fails with 401',
    fix: 'Token expired. Click Sign out at bottom, then sign in again.' },
  { symptom: 'Step 6 fails but Step 5 works',
    fix: 'Your AniList list is empty OR your privacy settings hide it.' },
]

function buildChecks(auth: AniListAuth | null): Check[] {
  const out: Check[] = []
  // Read the LIVE client id (env var OR the value pasted into the in-app
  // setup, which lives in localStorage) — not a stale module-load constant.
  const clientId = getClientId()
  out.push(clientId
    ? { id:'cid', label:'Step 1 — AniList Client ID is set',
        description:'From env var or in-app setup', status:'ok',
        message:`OK — value: ${clientId}` }
    : { id:'cid', label:'Step 1 — AniList Client ID is set',
        description:'From env var or in-app setup', status:'fail',
        message:'Not set. Paste your Client ID in the sign-in setup, or add VITE_ANILIST_CLIENT_ID to .env.local + restart.' })
  const stored = loadAuth()
  out.push(stored
    ? { id:'tok', label:'Step 2 — Token persisted to localStorage',
        description:'Key: kurodo-anilist-auth', status:'ok',
        message:`OK — token starts with ${stored.token.slice(0,12)}…` }
    : { id:'tok', label:'Step 2 — Token persisted to localStorage',
        description:'Key: kurodo-anilist-auth', status:'idle',
        message:'No token yet — sign in below.' })
  out.push(auth
    ? { id:'store', label:'Step 3 — Auth store hydrated with viewer',
        description:'useAuthStore().auth', status:'ok',
        message:`OK — signed in as ${auth.user.name} (#${auth.user.id})`,
        detail: JSON.stringify({ id:auth.user.id, name:auth.user.name,
          avatar:auth.user.avatar,
          expiresAt:new Date(auth.expiresAt).toISOString() }, null, 2) }
    : { id:'store', label:'Step 3 — Auth store hydrated with viewer',
        description:'useAuthStore().auth', status:'idle',
        message:'No user in memory yet.' })
  return out
}

function StatusIcon({ status }: { status: Status }) {
  if (status === 'ok')      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
  if (status === 'fail')    return <XCircle className="h-4 w-4 text-red-400" />
  if (status === 'running') return <Loader2 className="h-4 w-4 text-primary animate-spin" />
  return <Circle className="h-4 w-4 text-muted-foreground/40" />
}

function Row({ check, onCopy, action }: {
  check: Check; onCopy: (s: string) => void; action?: ReactNode
}) {
  return (
    <div className={cn(
      'glass-card rounded-xl p-4 border',
      check.status === 'ok'      && 'border-emerald-500/20',
      check.status === 'fail'    && 'border-red-500/30',
      check.status === 'idle'    && 'border-white/8',
      check.status === 'running' && 'border-primary/30',
    )}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5"><StatusIcon status={check.status} /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{check.label}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{check.description}</p>
          {check.message && (
            <p className={cn('mt-2 text-xs font-mono break-words',
              check.status === 'fail' ? 'text-red-300' : 'text-white/75')}>
              {check.message}
            </p>
          )}
          {check.detail && (
            <details className="mt-2">
              <summary className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold cursor-pointer hover:text-white">
                Show details
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-white/5 text-[10px] text-white/70 overflow-x-auto custom-scrollbar">{check.detail}</pre>
            </details>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {check.message && check.status === 'fail' && (
            <button onClick={() => onCopy(check.message!)} title="Copy error"
              className="text-muted-foreground hover:text-white p-1">
              <Copy className="h-3.5 w-3.5" />
            </button>
          )}
          {action}
        </div>
      </div>
    </div>
  )
}

export default function AuthDebug() {
  const auth = useAuthStore((s) => s.auth)
  const signOut = useAuthStore((s) => s.signOut)
  const watchlistCount = useWatchListStore((s) => s.watchlist.length)
  const continueCount = useWatchListStore((s) => s.continueWatching.length)
  useTitle('Auth Debug')

  const [checks, setChecks] = useState<Check[]>(() => buildChecks(auth))
  useEffect(() => { setChecks(buildChecks(auth)) }, [auth])

  const [viewer, setViewer] = useState<Check>({
    id: 'viewer', label: 'Step 5 — Fetch your AniList profile',
    description: 'GraphQL: query { Viewer { id name } }', status: 'idle',
  })
  const [list, setList] = useState<Check>({
    id: 'list', label: 'Step 6 — Fetch your anime list',
    description: 'GraphQL: MediaListCollection(userId, type: ANIME)', status: 'idle',
  })

  const runViewer = async () => {
    if (!auth) {
      setViewer((c) => ({ ...c, status: 'fail', message: 'Not signed in — complete step 4 first.' }))
      return
    }
    setViewer((c) => ({ ...c, status: 'running', message: 'Calling AniList…' }))
    try {
      const user = await fetchCurrentUser(auth.token)
      setViewer({
        id: 'viewer', label: 'Step 5 — Fetch your AniList profile',
        description: 'GraphQL: query { Viewer { id name } }', status: 'ok',
        message: `OK — ${user.name} (id ${user.id})`,
        detail: JSON.stringify(user, null, 2),
      })
    } catch (e) {
      setViewer((c) => ({ ...c, status: 'fail', message: (e as Error).message }))
    }
  }

  const runList = async () => {
    if (!auth) {
      setList((c) => ({ ...c, status: 'fail', message: 'Not signed in — complete step 4 first.' }))
      return
    }
    setList((c) => ({ ...c, status: 'running', message: 'Calling AniList…' }))
    try {
      const entries = await fetchUserList(auth.token, auth.user.id)
      const sample = entries.slice(0, 3).map((e) => ({
        status: e.status, progress: e.progress,
        title: e.media.title.english || e.media.title.romaji,
        idMal: e.media.idMal,
      }))
      setList({
        id: 'list', label: 'Step 6 — Fetch your anime list',
        description: 'GraphQL: MediaListCollection(userId, type: ANIME)', status: 'ok',
        message: `OK — ${entries.length} entries`,
        detail: `First entries:\n${JSON.stringify(sample, null, 2)}`,
      })
    } catch (e) {
      setList((c) => ({ ...c, status: 'fail', message: (e as Error).message }))
    }
  }

  const loginUrl = getLoginUrl()
  const expectedRedirect = typeof window !== 'undefined'
    ? `${window.location.origin}/auth/callback` : ''
  const copy = (s: string) => { void navigator.clipboard.writeText(s) }

  return (
    <div className="pt-20 pb-12 min-h-screen">
      <div className="max-w-[900px] mx-auto px-4">
        <div className="glass-card rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center">
              <AlertCircle className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white leading-tight">AniList Sign-in Diagnostic</h1>
              <p className="text-xs text-muted-foreground mt-0.5">Run each check top to bottom. The first one that fails is your bug.</p>
            </div>
            <Link to="/" className="text-xs text-muted-foreground hover:text-white underline">Back to app</Link>
          </div>
        </div>

        <div className="space-y-3">
          {checks.map((c) => <Row key={c.id} check={c} onCopy={copy} />)}

          <div className="glass-card rounded-xl p-4 border border-accent/25">
            <div className="flex items-start gap-3">
              <div className="mt-0.5">
                {auth
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  : <Circle className="h-4 w-4 text-muted-foreground/40" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">Step 4 — Click sign in & approve on AniList</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">AniList must redirect back to this URL exactly:</p>
                <div className="mt-2 flex items-center gap-1.5">
                  <code className="text-[11px] text-primary font-mono bg-black/40 px-2 py-1 rounded border border-white/5 truncate flex-1">{expectedRedirect}</code>
                  <button onClick={() => copy(expectedRedirect)} className="text-muted-foreground hover:text-white p-1" title="Copy">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  {loginUrl ? (
                    <a href={loginUrl} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90">
                      <LogIn className="h-3.5 w-3.5" /> Sign in with AniList
                    </a>
                  ) : (
                    <span className="text-xs text-red-400 flex items-center gap-1">
                      <XCircle className="h-3.5 w-3.5" /> Can't start — step 1 failed
                    </span>
                  )}
                  <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg glass text-white text-xs hover:bg-white/10 border border-white/10">
                    <ExternalLink className="h-3.5 w-3.5" /> AniList dev settings
                  </a>
                </div>
              </div>
            </div>
          </div>

          <Row check={viewer} onCopy={copy} action={
            <button onClick={runViewer} disabled={!auth || viewer.status === 'running'}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed">
              {viewer.status === 'running'
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
              Run
            </button>
          } />
          <Row check={list} onCopy={copy} action={
            <button onClick={runList} disabled={!auth || list.status === 'running'}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed">
              {list.status === 'running'
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <RefreshCw className="h-3 w-3" />}
              Run
            </button>
          } />
        </div>

        <div className="glass-card rounded-2xl p-5 mt-6">
          <h2 className="text-sm font-semibold text-white mb-3">Local app state</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-white/5 border border-white/8 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Watchlist</dt>
              <dd className="text-lg font-bold text-white mt-1">{watchlistCount}</dd>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/8 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Continue</dt>
              <dd className="text-lg font-bold text-white mt-1">{continueCount}</dd>
            </div>
            <div className="rounded-lg bg-white/5 border border-white/8 p-3">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Token expires</dt>
              <dd className="text-sm font-semibold text-white mt-1">{auth ? new Date(auth.expiresAt).toLocaleDateString() : '—'}</dd>
            </div>
          </dl>
          {auth && (
            <button onClick={() => { signOut(); window.location.reload() }}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25">
              <LogOut className="h-3.5 w-3.5" /> Sign out (clears localStorage)
            </button>
          )}
        </div>

        <div className="mt-6 glass-card rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-3">Common problems</h2>
          <div className="space-y-3">
            {FAQ.map((f) => (
              <details key={f.symptom} className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                <summary className="text-xs font-semibold text-white cursor-pointer hover:text-primary">{f.symptom}</summary>
                <pre className="mt-2 text-[11px] text-muted-foreground whitespace-pre-wrap">{f.fix}</pre>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
