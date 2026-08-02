// Scraper diagnostic page. Probes the full anidap pipeline so when streams
// stop working we can see exactly which step is broken without digging
// through logs.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, RefreshCw, Copy, ChevronRight,
} from 'lucide-react'
import { useTitle } from '../hooks/useTitle'
import { cn, getBackendOrigin } from '../lib/utils'

interface Step {
  label: string
  ok: boolean
  ms: number
  status?: number | null
  code?: string | null
  message?: string
  body?: string | null
  value?: unknown
}

interface DiagResult {
  at: string
  test: { anilistId: number; episode: number }
  steps: Step[]
}

export default function ScraperDebug() {
  useTitle('Scraper Debug')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DiagResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [anilistId, setAnilistId] = useState(101922) // Demon Slayer S1
  const [episode, setEpisode] = useState(1)

  const run = async () => {
    setRunning(true); setErr(null); setResult(null)
    try {
      const r = await fetch(
        `${getBackendOrigin()}/api/diag?anilistId=${anilistId}&ep=${episode}`,
      ).then((x) => x.json())
      if (!r.ok) throw new Error(r.error || 'diag failed')
      setResult(r.data)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const copy = (s: string) => navigator.clipboard.writeText(s).catch(() => {})

  return (
    <div className="pt-20 pb-12 min-h-screen">
      <div className="max-w-[900px] mx-auto px-4">
        {/* ───── Header ───── */}
        <div className="glass-card rounded-2xl p-5 mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/25 grid place-items-center">
              <AlertCircle className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white leading-tight">
                Scraper diagnostic
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Probes each step of the anidap.se pipeline so we can see exactly
                which one is broken.
              </p>
            </div>
            <Link to="/" className="text-xs text-muted-foreground hover:text-white underline">
              Back
            </Link>
          </div>

          <div className="mt-5 flex items-end gap-3 flex-wrap">
            <label className="text-xs text-muted-foreground">
              <div className="text-[10px] uppercase tracking-wider font-bold mb-1">AniList ID</div>
              <input
                type="number"
                value={anilistId}
                onChange={(e) => setAnilistId(Number(e.target.value))}
                className="w-32 rounded-lg bg-white/[0.04] border border-white/10 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              <div className="text-[10px] uppercase tracking-wider font-bold mb-1">Episode</div>
              <input
                type="number"
                value={episode}
                onChange={(e) => setEpisode(Number(e.target.value))}
                className="w-20 rounded-lg bg-white/[0.04] border border-white/10 px-2 py-1.5 text-sm text-white focus:border-primary/50 focus:outline-none"
              />
            </label>
            <button
              onClick={run}
              disabled={running}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {running
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              {running ? 'Running…' : 'Run probe'}
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {[
              { id: 101922, name: 'Demon Slayer' },
              { id: 21,     name: 'One Piece' },
              { id: 1535,   name: 'Death Note' },
              { id: 16498,  name: 'Attack on Titan' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => { setAnilistId(p.id); setEpisode(1) }}
                className="text-[11px] font-semibold px-2 py-1 rounded bg-white/[0.04] border border-white/8 text-white/70 hover:bg-white/[0.08] hover:text-white"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="glass-card border border-red-500/30 rounded-xl p-4 mb-5">
            <p className="text-sm text-red-300 font-semibold">Probe failed</p>
            <p className="text-xs text-muted-foreground mt-1">{err}</p>
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <p className="text-[11px] text-muted-foreground px-1">
              Probed at {new Date(result.at).toLocaleTimeString()} · AniList #{result.test.anilistId}, episode {result.test.episode}
            </p>
            {result.steps.map((s, i) => (
              <StepRow key={i} step={s} onCopy={copy} />
            ))}

            {/* Summary */}
            <div className="glass-card rounded-xl p-4 border border-white/8">
              {result.steps.every((s) => s.ok) ? (
                <p className="text-sm text-emerald-400 font-semibold">
                  ✓ All steps passed — scraper is working end-to-end.
                </p>
              ) : (
                <>
                  <p className="text-sm text-red-300 font-semibold mb-1">
                    Pipeline broke at:{' '}
                    <span className="text-white">
                      {result.steps.find((s) => !s.ok)?.label}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {result.steps.find((s) => !s.ok)?.status === 500
                      ? 'anidap returned 500 — usually means anti-bot caught us. Bump the User-Agent / sec-ch-ua versions in server/anidap.js to match current Chrome.'
                      : result.steps.find((s) => !s.ok)?.status === 403
                        ? 'anidap returned 403 — anti-bot block. Same fix as 500.'
                        : 'See the message above. If it mentions decrypt/AES, the crypto keys in server/anidap.js need refreshing from the upstream scraper repo.'}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StepRow({ step, onCopy }: { step: Step; onCopy: (s: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      className={cn(
        'glass-card rounded-xl p-4 border',
        step.ok ? 'border-emerald-500/20' : 'border-red-500/30',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {step.ok
            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            : <XCircle className="h-4 w-4 text-red-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-white truncate">{step.label}</p>
            <span className="text-[10px] font-mono text-muted-foreground">{step.ms}ms</span>
          </div>
          {step.ok ? (
            <p className="text-xs text-white/70 mt-1 font-mono break-all">
              {JSON.stringify(step.value)}
            </p>
          ) : (
            <>
              <p className="text-xs text-red-300 mt-1 font-mono break-words">
                {step.status ? `HTTP ${step.status} · ` : ''}
                {step.code ? `${step.code} · ` : ''}
                {step.message}
              </p>
              {step.body && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-[10px] uppercase tracking-wider text-muted-foreground hover:text-white font-bold mt-2 inline-flex items-center gap-1"
                >
                  <ChevronRight className={cn('h-2.5 w-2.5 transition-transform', expanded && 'rotate-90')} />
                  Response body
                </button>
              )}
              {expanded && step.body && (
                <pre className="mt-2 p-3 rounded-lg bg-black/40 border border-white/5 text-[10px] text-white/70 overflow-x-auto custom-scrollbar">
                  {step.body}
                </pre>
              )}
            </>
          )}
        </div>
        {!step.ok && step.message && (
          <button
            onClick={() => onCopy(step.message!)}
            className="text-muted-foreground hover:text-white p-1"
            title="Copy error"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
