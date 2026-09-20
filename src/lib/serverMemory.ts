// Persistent server memory — "keep the same servers every session".
//
// fixes: "every time I close the app and open it again different servers
//         appear" — the picker order used to be reshuffled on every fetch by
//         the per-episode health probe verdicts (`_healthy`), which race and
//         differ run-to-run. The probe result is still used invisibly to
//         avoid auto-picking a verified-dead server, but it no longer decides
//         the VISIBLE order. What decides it now:
//
//   0. this memory  — servers the user actually played successfully
//                     (persistent in localStorage, learned over time)
//   1. static measured capability  (PROVIDER_META priority)
//   2. tip quality / default flag / alpha  (deterministic tie-breakers)
//
// Every counter is keyed by the cleaned server name ("anidap-Loli" → "loli"),
// so the memory survives family-prefix changes upstream.

const KEY = 'kurodo-server-memory'

interface ServerMemory {
  /** Times a server successfully resolved a stream for the user. */
  good: Record<string, number>
  /** Times a server failed to resolve (auto-failover moved past it). */
  bad: Record<string, number>
  /** Last event time per server, for debugging. */
  ts: Record<string, number>
}

let cache: ServerMemory | null = null

/** Strip family prefixes so "anidap-Loli", "miruro-Loli" and "Loli" share
 *  one memory entry — the user thinks in server names, not family tags. */
export function cleanServerKey(name: string): string {
  return name.replace(/^(anidap|gogoanime|miruro|saturn|pahe)-/i, '').toLowerCase()
}

function load(): ServerMemory {
  if (cache) return cache
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    const parsed = raw ? (JSON.parse(raw) as ServerMemory) : null
    cache = parsed && parsed.good && parsed.bad ? parsed : { good: {}, bad: {}, ts: {} }
  } catch {
    cache = { good: {}, bad: {}, ts: {} }
  }
  return cache
}

function save(m: ServerMemory): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(m))
  } catch { /* private mode / quota — memory just stays in-session */ }
}

/** Record that this server successfully delivered a playable stream. */
export function rememberServerGood(name: string): void {
  if (!name) return
  const m = load()
  const k = cleanServerKey(name)
  m.good[k] = (m.good[k] ?? 0) + 1
  m.ts[k] = Date.now()
  save(m)
}

/** Record that this server failed to resolve (the failover moved past it). */
export function rememberServerBad(name: string): void {
  if (!name) return
  const m = load()
  const k = cleanServerKey(name)
  m.bad[k] = (m.bad[k] ?? 0) + 1
  m.ts[k] = Date.now()
  save(m)
}

/** Proven-good = played at least once AND successes ≥ failures. A server
 *  that worked before but keeps failing now loses its pinned top slot. */
export function isRememberedGood(name: string): boolean {
  const m = load()
  const k = cleanServerKey(name)
  return (m.good[k] ?? 0) > 0 && (m.good[k] ?? 0) >= (m.bad[k] ?? 0)
}

/** Tie-break score among remembered servers (more successes first). */
export function serverMemoryScore(name: string): number {
  const m = load()
  const k = cleanServerKey(name)
  return (m.good[k] ?? 0) - (m.bad[k] ?? 0)
}

/** Debug/reset for Settings → Diagnostics. */
export function clearServerMemory(): void {
  cache = { good: {}, bad: {}, ts: {} }
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY) } catch { /* noop */ }
}
