import { useEffect, useMemo, useState } from 'react'

import {
  Activity, CheckCircle2, AlertTriangle, XCircle, Loader2, RotateCw,
  Server, Globe, Film, Captions, Clock, ChevronRight, Zap, Database,
  Cpu, HardDrive, Copy, ClipboardCheck,
} from 'lucide-react'
import axios from 'axios'
import { useTitle } from '../hooks/useTitle'
import { cn, getBackendOrigin } from '../lib/utils'

type Status = 'ok' | 'warn' | 'error' | 'pending'

interface ProbeResult {
  status: Status
  ms: number          // round-trip in ms
  detail?: string     // short human-readable note
  data?: unknown      // raw response (truncated) for the "raw" toggle
  /** When set, surface as the primary cause of warn/error. */
  hint?: string
}

interface ProbeDef {
  id: string
  group: string
  label: string
  description: string
  icon: typeof Server
  run: () => Promise<ProbeResult>
}

// ──────────────────────────────────────────────────────────────────
// Individual probes — each is a function returning ProbeResult
// ──────────────────────────────────────────────────────────────────

const DEMON_SLAYER_ANILIST = 101922
const DEMON_SLAYER_SLUG = 'demon-slayer-kimetsu-no-yaiba-j2hzd'

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t0) }
}

function failProbe(e: unknown, ms = 0): ProbeResult {
  const msg = e instanceof Error ? e.message : String(e)
  return { status: 'error', ms, detail: msg.slice(0, 200), hint: msg.slice(0, 200) }
}

// ── 1. Backend health ──
async function probeBackendHealth(): Promise<ProbeResult> {
  try {
    const { value, ms } = await timed(() =>
      axios.get(`${getBackendOrigin()}/api/health`, { timeout: 8000, validateStatus: () => true }),
    )
    if (value.status !== 200 || !value.data?.ok) {
      return { status: 'error', ms, detail: `HTTP ${value.status}`, data: value.data }
    }
    return {
      status: ms < 250 ? 'ok' : ms < 1000 ? 'warn' : 'error',
      ms,
      detail: `${value.data?.service || 'backend'} alive`,
      data: value.data,
    }
  } catch (e) { return failProbe(e) }
}

// ── 2. Anidap slug resolution ──
async function probeAnidapSlug(): Promise<ProbeResult> {
  try {
    const { value, ms } = await timed(() =>
      axios.get(`/api/anidap/info/${DEMON_SLAYER_ANILIST}`, { timeout: 12000, validateStatus: () => true }),
    )
    if (!value.data?.ok || !value.data?.data?.slug) {
      return { status: 'error', ms, detail: value.data?.error || `HTTP ${value.status}` }
    }
    return {
      status: ms < 1500 ? 'ok' : ms < 4000 ? 'warn' : 'error',
      ms,
      detail: `slug=${value.data.data.slug}`,
      data: { slug: value.data.data.slug, source: value.data.data.source },
    }
  } catch (e) { return failProbe(e) }
}

// ── 3. Anidap episodes ──
async function probeAnidapEpisodes(): Promise<ProbeResult> {
  try {
    const { value, ms } = await timed(() =>
      axios.get(`${getBackendOrigin()}/api/anidap/episodes/${DEMON_SLAYER_SLUG}?anilistId=${DEMON_SLAYER_ANILIST}`,
        { timeout: 12000, validateStatus: () => true }),
    )
    const list = value.data?.data?.episodes ?? []
    if (!value.data?.ok || list.length === 0) {
      return { status: 'error', ms, detail: value.data?.error || 'empty list' }
    }
    return {
      status: ms < 2000 ? 'ok' : ms < 5000 ? 'warn' : 'error',
      ms,
      detail: `${list.length} episodes (first: "${(list[0]?.title || '').slice(0, 40)}")`,
      data: { count: list.length, first: list[0] },
    }
  } catch (e) { return failProbe(e) }
}

// ── 4. Anidap servers ──
async function probeAnidapServers(): Promise<ProbeResult> {
  try {
    const { value, ms } = await timed(() =>
      axios.get(`${getBackendOrigin()}/api/anidap/servers/${DEMON_SLAYER_SLUG}/1?anilistId=${DEMON_SLAYER_ANILIST}`,
        { timeout: 12000, validateStatus: () => true }),
    )
    const providers = value.data?.data?.providers ?? []
    if (!value.data?.ok || providers.length === 0) {
      return { status: 'error', ms, detail: value.data?.error || 'no providers' }
    }
    return {
      status: ms < 2000 ? 'ok' : ms < 5000 ? 'warn' : 'error',
      ms,
      detail: `${providers.length} providers (${providers.map((p: { name: string }) => p.name).slice(0, 4).join(', ')}…)`,
      data: { source: value.data.data.source, providers: providers.slice(0, 4) },
    }
  } catch (e) { return failProbe(e) }
}

// ── 5. Anidap sources (the full pipeline) ──
async function probeAnidapSources(): Promise<ProbeResult> {
  try {
    const { value, ms } = await timed(() =>
      axios.get(`${getBackendOrigin()}/api/anidap/sources/${DEMON_SLAYER_SLUG}/1/yuki/sub?anilistId=${DEMON_SLAYER_ANILIST}`,
        { timeout: 15000, validateStatus: () => true }),
    )
    const url = value.data?.data?.url
    if (!value.data?.ok || !url) {
      return { status: 'error', ms, detail: value.data?.error || 'no stream' }
    }
    return {
      status: ms < 3000 ? 'ok' : ms < 8000 ? 'warn' : 'error',
      ms,
      detail: `→ ${new URL(url).host}`,
      data: { host: new URL(url).host, headers: value.data.data.headers },
    }
  } catch (e) { return failProbe(e) }
}

// ── 6. HLS proxy (m3u8 round-trip) ──
async function probeHlsProxy(): Promise<ProbeResult> {
  try {
    // Get a fresh source URL first to make sure the token hasn't expired.
    const src = await axios.get(`${getBackendOrigin()}/api/anidap/sources/${DEMON_SLAYER_SLUG}/1/yuki/sub?anilistId=${DEMON_SLAYER_ANILIST}`,
      { timeout: 12000, validateStatus: () => true })
    const proxiedUrl = src.data?.data?.proxiedUrl
    if (!proxiedUrl) return { status: 'error', ms: 0, detail: 'no proxiedUrl' }

    const { value, ms } = await timed(() =>
      axios.get(proxiedUrl, { timeout: 12000, validateStatus: () => true, responseType: 'text' }),
    )
    const body = String(value.data).slice(0, 200)
    const isM3u8 = body.startsWith('#EXTM3U')
    return {
      status: isM3u8 ? (ms < 1500 ? 'ok' : 'warn') : 'error',
      ms,
      detail: isM3u8 ? `#EXTM3U received (${body.length} bytes)` : `not a manifest: ${body.slice(0, 80)}`,
      data: { snippet: body.slice(0, 200) },
    }
  } catch (e) { return failProbe(e) }
}

// ── 7. Subtitle MIME proxy ──
async function probeSubtitleProxy(): Promise<ProbeResult> {
  try {
    // Reuse the sources call to get a real subtitle URL
    const src = await axios.get(`${getBackendOrigin()}/api/anidap/sources/${DEMON_SLAYER_SLUG}/1/yuki/sub?anilistId=${DEMON_SLAYER_ANILIST}`,
      { timeout: 12000, validateStatus: () => true })
    const subs = src.data?.data?.subtitles ?? []
    if (subs.length === 0) {
      return { status: 'warn', ms: 0, detail: 'no subtitle tracks for this stream' }
    }
    const headers = src.data?.data?.headers || {}
    const h = btoa(JSON.stringify(headers))
    const proxied = `${getBackendOrigin()}/proxy?url=${encodeURIComponent(subs[0].file)}&h=${encodeURIComponent(h)}`
    const { value, ms } = await timed(() =>
      axios.get(proxied, { timeout: 10000, validateStatus: () => true, responseType: 'text' }),
    )
    const ct = String(value.headers['content-type'] || '')
    const body = String(value.data).slice(0, 80)
    const isVtt = ct.includes('text/vtt') && body.startsWith('WEBVTT')
    return {
      status: isVtt ? 'ok' : 'error',
      ms,
      detail: `content-type=${ct.slice(0, 30)} · body="${body.slice(0, 40)}"`,
      data: { ct, snippet: body },
    }
  } catch (e) { return failProbe(e) }
}

// ── 8. AniList GraphQL latency ──
// Routed through /api/anilist-gql proxy (backend → AniList)
// because the browser cannot call graphql.anilist.co directly (CORS).
async function probeAniList(): Promise<ProbeResult> {
  try {
    const endpoint = window.location.hostname === 'localhost'
      ? `${getBackendOrigin()}/api/anilist-gql`
      : 'https://graphql.anilist.co'
    const { value, ms } = await timed(() =>
      axios.post(endpoint, {
        query: '{ Media(id: 21, type: ANIME) { id title { romaji } } }',
      }, { timeout: 8000, validateStatus: () => true }),
    )
    const ok = value.status === 200 && value.data?.data?.Media?.id === 21
    return {
      status: ok ? (ms < 800 ? 'ok' : 'warn') : 'error',
      ms,
      detail: ok ? 'GraphQL handshake OK' : `HTTP ${value.status}`,
      data: value.data,
    }
  } catch (e) { return failProbe(e) }
}

// ── 9. Jikan API latency ──
// Routed through /api/jikan proxy on localhost (same pattern as anilist-gql).
async function probeJikan(): Promise<ProbeResult> {
  try {
    const endpoint = window.location.hostname === 'localhost'
      ? `${getBackendOrigin()}/api/jikan/anime/1`
      : 'https://api.jikan.moe/v4/anime/1'
    const { value, ms } = await timed(() =>
      axios.get(endpoint, { timeout: 8000, validateStatus: () => true }),
    )
    const ok = value.status === 200 && !!value.data?.data?.mal_id
    return {
      status: ok ? (ms < 1500 ? 'ok' : 'warn') : 'error',
      ms,
      detail: ok ? `${value.data.data.title}` : `HTTP ${value.status}`,
      data: value.data?.data ? { mal_id: value.data.data.mal_id } : value.data,
    }
  } catch (e) { return failProbe(e) }
}

// ── 10. AniSkip ──
async function probeAniSkip(): Promise<ProbeResult> {
  try {
    const { value, ms } = await timed(() =>
      axios.get(`https://api.aniskip.com/v2/skip-times/${DEMON_SLAYER_ANILIST}/1?types[]=op&types[]=ed&episodeLength=0`,
        { timeout: 8000, validateStatus: () => true }),
    )
    const ok = value.status === 200
    return {
      status: ok ? (ms < 1200 ? 'ok' : 'warn') : 'warn',
      ms,
      detail: ok ? 'API alive' : `HTTP ${value.status} (still OK, just no skip data)`,
      data: value.data,
    }
  } catch (e) { return failProbe(e) }
}

// ──────────────────────────────────────────────────────────────────
const PROBES: ProbeDef[] = [
  { id: 'backend',       group: 'Backend',  label: 'Backend /api/health',  description: 'Express server liveness',                 icon: Server,    run: probeBackendHealth },
  { id: 'anidap-slug',   group: 'Anidap',   label: 'Slug resolution',      description: 'AniList ID → anidap.se /info/N.data',     icon: Database,  run: probeAnidapSlug },
  { id: 'anidap-eps',    group: 'Anidap',   label: 'Episode list',         description: 'chad.anidap.se /rest/api/episodes',       icon: Film,      run: probeAnidapEpisodes },
  { id: 'anidap-srv',    group: 'Anidap',   label: 'Server list',          description: 'chad.anidap.se /rest/api/servers',        icon: Server,    run: probeAnidapServers },
  { id: 'anidap-src',    group: 'Anidap',   label: 'Stream sources',       description: 'chad.anidap.se /rest/api/sources (yuki)', icon: Zap,       run: probeAnidapSources },
  { id: 'hls-proxy',     group: 'Streaming', label: 'HLS proxy m3u8',      description: 'Backend /proxy fetches a real manifest',  icon: Film,      run: probeHlsProxy },
  { id: 'sub-proxy',     group: 'Streaming', label: 'Subtitle proxy MIME', description: 'Verifies text/vtt content-type rewrite',  icon: Captions,  run: probeSubtitleProxy },
  { id: 'anilist',       group: 'Upstream', label: 'AniList GraphQL',      description: 'graphql.anilist.co handshake',            icon: Globe,     run: probeAniList },
  { id: 'jikan',         group: 'Upstream', label: 'Jikan API',            description: 'api.jikan.moe v4 (rate-limited public)',  icon: Globe,     run: probeJikan },
  { id: 'aniskip',       group: 'Upstream', label: 'AniSkip',              description: 'api.aniskip.com — intro/outro times',     icon: Clock,     run: probeAniSkip },
]

const REFRESH_MS = 30_000

// ──────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────

export default function HealthPage() {
  useTitle('Health')
  const [results, setResults] = useState<Record<string, ProbeResult>>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [lastRunAt, setLastRunAt] = useState<number | null>(null)
  const [nextRunAt, setNextRunAt] = useState<number>(Date.now() + REFRESH_MS)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [sysInfo, setSysInfo] = useState<{ uptime: number; node: string; memory: number; cacheSize: number; failCacheSize: number; version: string } | null>(null)
  const [issueSummary, setIssueSummary] = useState('')
  const [copied, setCopied] = useState(false)

  // Run a single probe
  const runOne = async (def: ProbeDef) => {
    setRunning((r) => ({ ...r, [def.id]: true }))
    try {
      const res = await def.run()
      setResults((r) => ({ ...r, [def.id]: res }))
    } finally {
      setRunning((r) => ({ ...r, [def.id]: false }))
    }
  }

  // Run all probes in parallel (each one is independent)
  const runAll = async () => {
    setLastRunAt(Date.now())
    setNextRunAt(Date.now() + REFRESH_MS)
    await Promise.all([
      ...PROBES.map((d) => runOne(d)),
      fetchSysInfo(),
    ])
  }

  const fetchSysInfo = async () => {
    try {
      const r = await axios.get(`${getBackendOrigin()}/api/health`, { timeout: 5000 })
      if (r.data?.ok) {
        setSysInfo({
          uptime: r.data.uptime ?? 0,
          node: r.data.node ?? '?',
          memory: r.data.memory ?? 0,
          cacheSize: r.data.cache?.size ?? 0,
          failCacheSize: r.data.cache?.failSize ?? 0,
          version: r.data.version ?? '?',
        })
      }
    } catch { /* non-critical */ }
  }

  // First run on mount
  useEffect(() => {
  // Run all probes once on mount — runAll() is stable (not derived from
    // any external deps), so the empty array is intentional.
    void runAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-refresh ticker
  useEffect(() => {
    if (!autoRefresh) return
    // Restart interval when auto-refresh toggles. We deliberately omit
    // runAll() from deps — it's a closure over runOne()/fetchSysInfo()
    // which are stable. Including it would re-create the interval on
    // every render.
    const t = window.setInterval(() => { void runAll() }, REFRESH_MS)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh])

  // Countdown until next auto-refresh
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!autoRefresh) return
    const t = window.setInterval(() => setTick((x) => x + 1), 1000)
    return () => window.clearInterval(t)
  }, [autoRefresh])
  const secondsToNext = Math.max(0, Math.round((nextRunAt - Date.now()) / 1000))

  // Group results
  const grouped = useMemo(() => {
    const m: Record<string, ProbeDef[]> = {}
    for (const p of PROBES) (m[p.group] ||= []).push(p)
    return m
  }, [])

  // Overall status (worst of all probes)
  const overall: Status = useMemo(() => {
    const ids = PROBES.map((p) => p.id)
    if (ids.some((id) => results[id]?.status === 'error')) return 'error'
    if (ids.some((id) => results[id]?.status === 'warn')) return 'warn'
    if (ids.every((id) => results[id]?.status === 'ok')) return 'ok'
    return 'pending'
  }, [results])

  const okCount = Object.values(results).filter((r) => r.status === 'ok').length
  const warnCount = Object.values(results).filter((r) => r.status === 'warn').length
  const errCount = Object.values(results).filter((r) => r.status === 'error').length
  const issuePayload = useMemo(() => ({
    generatedAt: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    summary: issueSummary.trim() || '(no summary provided)',
    overall,
    counts: { ok: okCount, warn: warnCount, error: errCount, total: PROBES.length },
    system: sysInfo,
    probes: PROBES.map((p) => ({
      id: p.id,
      label: p.label,
      group: p.group,
      ...results[p.id],
    })),
  }), [issueSummary, overall, okCount, warnCount, errCount, sysInfo, results])

  const copyIssuePayload = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(issuePayload, null, 2))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="pt-20 pb-16">
      <div className="max-w-4xl mx-auto px-4">
        {/* ── Header card ── */}
        <div className={cn(
          'glass-card rounded-2xl p-5 mb-5 border',
          overall === 'ok' && 'border-emerald-500/30',
          overall === 'warn' && 'border-amber-400/30',
          overall === 'error' && 'border-red-500/30',
          overall === 'pending' && 'border-white/10',
        )}>
          <div className="flex items-start gap-4 flex-wrap">
            <div className={cn(
              'h-12 w-12 rounded-xl grid place-items-center shrink-0',
              overall === 'ok' && 'bg-emerald-500/15',
              overall === 'warn' && 'bg-amber-400/15',
              overall === 'error' && 'bg-red-500/15',
              overall === 'pending' && 'bg-white/5',
            )}>
              <StatusIcon status={overall} size={5} />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white">
                System health · <span className={cn(
                  overall === 'ok' && 'text-emerald-300',
                  overall === 'warn' && 'text-amber-300',
                  overall === 'error' && 'text-red-300',
                  overall === 'pending' && 'text-white/60',
                )}>{overall === 'pending' ? 'Checking…' : overall.toUpperCase()}</span>
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {okCount}/{PROBES.length} healthy
                {warnCount > 0 && <> · <span className="text-amber-300">{warnCount} warn</span></>}
                {errCount > 0 && <> · <span className="text-red-300">{errCount} error</span></>}
                {lastRunAt && (
                  <> · last check {Math.max(0, Math.round((Date.now() - lastRunAt) / 1000))}s ago</>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                  autoRefresh
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-white/65',
                )}
                title={autoRefresh ? 'Auto-refresh enabled' : 'Auto-refresh paused'}
              >
                {autoRefresh ? `Auto · ${secondsToNext}s` : 'Auto · off'}
              </button>
              <button
                onClick={() => void runAll()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90"
              >
                <RotateCw className={cn('h-3 w-3', Object.values(running).some(Boolean) && 'animate-spin')} />
                Re-check now
              </button>
            </div>
          </div>
        </div>

        {/* ── Probe groups ── */}
        {Object.entries(grouped).map(([group, defs]) => (
          <section key={group} className="mb-4">
            <h2 className="text-[10px] uppercase tracking-[0.15em] font-bold text-white/45 mb-2 px-1">
              {group}
            </h2>
            <div className="glass-card rounded-xl overflow-hidden">
              {defs.map((def, i) => {
                const res = results[def.id]
                const isRunning = !!running[def.id]
                const status: Status = isRunning && !res ? 'pending' : res?.status ?? 'pending'
                const Icon = def.icon
                const isOpen = expandedId === def.id
                return (
                  <div
                    key={def.id}
                    className={cn(
                      'border-white/5',
                      i > 0 && 'border-t',
                    )}
                  >
                    <button
                      onClick={() => setExpandedId(isOpen ? null : def.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] text-left transition-colors"
                    >
                      <div className={cn(
                        'h-8 w-8 rounded-lg grid place-items-center shrink-0',
                        status === 'ok' && 'bg-emerald-500/10 text-emerald-300',
                        status === 'warn' && 'bg-amber-400/10 text-amber-300',
                        status === 'error' && 'bg-red-500/10 text-red-300',
                        status === 'pending' && 'bg-white/5 text-white/40',
                      )}>
                        {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-white truncate">{def.label}</p>
                          <StatusBadge status={status} />
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {res?.detail || def.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {res && (
                          <span className={cn(
                            'text-[11px] font-mono tabular-nums',
                            res.ms < 500 ? 'text-emerald-300'
                              : res.ms < 2000 ? 'text-amber-300'
                              : 'text-red-300',
                          )}>
                            {res.ms}ms
                          </span>
                        )}
                        <ChevronRight className={cn(
                          'h-4 w-4 text-white/30 transition-transform',
                          isOpen && 'rotate-90',
                        )} />
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 space-y-3 bg-black/20 border-t border-white/5">
                        <p className="text-[11px] text-white/55 leading-relaxed">{def.description}</p>
                        {res?.hint && (
                          <div className="text-[11px] text-red-200 bg-red-500/5 border border-red-500/15 rounded p-2 leading-relaxed">
                            <strong>Hint:</strong> {res.hint}
                          </div>
                        )}
                        {(res?.data != null) && (
                          <details className="text-[10px]">
                            <summary className="cursor-pointer text-white/50 hover:text-white/80 font-mono">
                              Raw response
                            </summary>
                            <pre data-lenis-prevent className="mt-2 max-h-48 overflow-auto rounded-md bg-black/40 border border-white/5 p-2 text-white/65 whitespace-pre-wrap">
                              {JSON.stringify(res.data, null, 2)}
                            </pre>
                          </details>
                        )}
                        <button
                          onClick={() => void runOne(def)}
                          disabled={isRunning}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[11px] font-semibold text-white/85 disabled:opacity-50"
                        >
                          <RotateCw className={cn('h-3 w-3', isRunning && 'animate-spin')} />
                          Re-run this probe
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        {/* ── System info ── */}
        {sysInfo && (
          <section className="mb-4">
            <h2 className="text-[10px] uppercase tracking-[0.15em] font-bold text-white/45 mb-2 px-1">
              System
            </h2>
            <div className="glass-card rounded-xl overflow-hidden">
              <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCell icon={Cpu} label="Node.js" value={sysInfo.node} />
                <StatCell icon={Clock} label="Uptime" value={fmtUptime(sysInfo.uptime)} />
                <StatCell icon={HardDrive} label="Memory" value={`${sysInfo.memory} MB`} />
                <StatCell icon={Database} label="Cache" value={`${sysInfo.cacheSize} entries`} />
                <StatCell icon={Database} label="Fail cache" value={`${sysInfo.failCacheSize} entries`} />
                <StatCell icon={Server} label="Version" value={`v${sysInfo.version}`} />
              </div>
            </div>
          </section>
        )}

        <section className="mb-4">
          <h2 className="text-[10px] uppercase tracking-[0.15em] font-bold text-white/45 mb-2 px-1">
            Issue report
          </h2>
          <div className="glass-card rounded-xl p-4 space-y-3">
            <p className="text-xs text-white/70">
              Describe what is broken (for example: scroll animation glitches, dead servers). Then copy this diagnostics payload into your issue.
            </p>
            <textarea
              value={issueSummary}
              onChange={(e) => setIssueSummary(e.target.value)}
              placeholder="Example: On Watch page, episode sidebar scroll jumps and server list returns no providers."
              className="w-full min-h-24 rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/35 outline-none focus:border-primary/40"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => void copyIssuePayload()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90"
              >
                {copied ? <ClipboardCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy diagnostics JSON'}
              </button>
              <span className="text-[11px] text-white/50">
                Includes probe results, system info, URL, browser, and your summary.
              </span>
            </div>
          </div>
        </section>


      </div>
    </div>
  )
}

function StatusIcon({ status, size = 4 }: { status: Status; size?: number }) {
  // Map size to static Tailwind classes Tailwind can see at build time.
  const cls = size === 5 ? 'h-5 w-5' : size === 6 ? 'h-6 w-6' : 'h-4 w-4'
  if (status === 'ok')      return <CheckCircle2 className={cn(cls, 'text-emerald-300')} />
  if (status === 'warn')    return <AlertTriangle className={cn(cls, 'text-amber-300')} />
  if (status === 'error')   return <XCircle className={cn(cls, 'text-red-300')} />
  return <Activity className={cn(cls, 'text-white/50')} />
}

function StatCell({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-7 w-7 rounded-lg bg-white/5 grid place-items-center shrink-0">
        <Icon className="h-3.5 w-3.5 text-white/40" />
      </div>
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</p>
        <p className="text-xs font-mono text-white/80 truncate">{value}</p>
      </div>
    </div>
  )
}

function fmtUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}

function StatusBadge({ status }: { status: Status }) {
  const meta = {
    ok:      { bg: 'bg-emerald-500/15', fg: 'text-emerald-300', label: 'OK'      },
    warn:    { bg: 'bg-amber-400/15',   fg: 'text-amber-300',   label: 'WARN'    },
    error:   { bg: 'bg-red-500/15',     fg: 'text-red-300',     label: 'ERROR'   },
    pending: { bg: 'bg-white/8',        fg: 'text-white/55',    label: '…'       },
  }[status]
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-px rounded text-[9px] uppercase tracking-wider font-bold shrink-0',
      meta.bg, meta.fg,
    )}>
      {meta.label}
    </span>
  )
}
