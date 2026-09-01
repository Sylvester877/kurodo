// server/server-verify.js — LIVE per-title server verification.
//
// Why this exists (Aug 2026):
//   chad lists servers per-episode, but a listed server can still be dead
//   for that title: upstream 404s "no sources" (kiwi on every test title),
//   or the returned link dies minutes later (yuki/dub on FMA:B). Clicking
//   such a tile = 30s spinner → "Couldn't load this stream" — the exact
//   "all servers are broken" report. The old server-level health probe
//   (One Piece only) can't see any of this.
//
//   This module verifies each listed server AGAINST THE ACTUAL TITLE with
//   a real source fetch + master-manifest probe, and marks failing servers
//   _healthy:false so the UI grays them out and the router skips them.
//
// Design constraints:
//   • Serial, low-concurrency — every probe consumes real upstream quota
//     (chad calls, browser mutex). No fan-out bursts that trigger 429s.
//   • Cached 15 min per (title, server, type). Warm lists return instantly;
//     only unknown servers are probed on a cold title.
//   • Never throws — the servers route must always return a list.
//   • Probe budget per server: ~12s (matches the sources route cap).

import { routedGetStream } from './providers/router.js'

const PROBE_TTL_OK = 15 * 60 * 1000   // verified working — trust 15 min
const PROBE_TTL_FAIL = 3 * 60 * 1000  // failed — retry in 3 min (servers recover)
const PROBE_TIMEOUT_MS = 12_000       // per-server hard cap
const MAX_PROBES_PER_TICK = 3         // cap per request so one cold title
                                      // doesn't drain the chad API budget
                                      // (probes are also paced by chadGet)
const PROBE_CONCURRENCY = 1           // serial — smoothest possible probing

const verdicts = new Map() // `${slugOrId}:${ep}:${name}:${type}` -> { ok, at }

// ── hsub probes are poisoned by chad's bot-window ──
// When chad is bot-blocked, a probe can't even SEE whether a server has
// hsub sources (the browser path returns empty for that type) — calling
// that "dead" blacklists every hsub server for 3-15 min on every title.
// Track the last chad block window; probes that ran inside it get a short
// TTL (re-probe soon) instead of the long OK verdict.
let lastChadBlockAt = 0
setInterval(() => {
  import('./anidap.js').then(({ isChadBlocked }) => {
    if (isChadBlocked()) lastChadBlockAt = Date.now()
  }).catch(() => {})
}, 60_000).unref()

function pruneVerdicts() {
  const now = Date.now()
  for (const [k, v] of verdicts) {
    const ttl = v.ok ? PROBE_TTL_OK : PROBE_TTL_FAIL
    if (now - v.at > ttl) verdicts.delete(k)
  }
}

export function getCachedVerdict(slug, ep, name, type) {
  const v = verdicts.get(`${slug}:${ep}:${name}:${type}`)
  if (!v) return null
  const ttl = v.ok ? PROBE_TTL_OK : PROBE_TTL_FAIL
  if (Date.now() - v.at > ttl) {
    verdicts.delete(`${slug}:${ep}:${name}:${type}`)
    return null
  }
  return v.ok
}

/** Probe one server with a REAL stream fetch + master check. */
async function probeServer({ anilistId, slug, ep, name, type, titles }) {
  const t0 = Date.now()
  try {
    const data = await Promise.race([
      routedGetStream(anilistId, slug, ep, name, type, {}, titles, new AbortController().signal),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS),
      ),
    ])
    const ms = Date.now() - t0
    if (!data?.url) return { ok: false, ms, why: 'no stream' }

    // Master probe through /proxy — the exact path the player takes.
    // Definitive 4xx (429 excluded — that's a rate window, not a dead link)
    // marks the server unhealthy.
    const referer = data.headers?.Referer || data.headers?.referer || undefined
    let h = ''
    if (referer) {
      h = `&h=${encodeURIComponent(Buffer.from(JSON.stringify({ Referer: referer })).toString('base64'))}`
    }
    const origin = `http://127.0.0.1:${Number(process.env.PORT) || 5173}`
    const masterUrl = data.raw || data.url
    try {
      const res = await fetch(
        `${origin}/proxy?url=${encodeURIComponent(masterUrl)}${h}`,
        { signal: AbortSignal.timeout(6_000) },
      )
      if (res.status === 429) return { ok: true, ms } // rate window ≠ dead
      if (res.status >= 400) return { ok: false, ms, why: `master ${res.status}` }
      const head = (await res.text()).trimStart().slice(0, 8)
      if (!head.startsWith('#EXTM3U')) return { ok: false, ms, why: 'master not playlist' }
    } catch {
      // probe fetch failed (network hiccup) — trust the extraction itself
      return { ok: true, ms }
    }
    return { ok: true, ms }
  } catch (e) {
    const msg = e?.message?.slice(0, 40) || 'failed'
    // ── Chad-blocked probes are NOT verdicts ──
    // If chad went bot-blocked around this probe, the "no stream" answer
    // may just mean the API window was closed. Cache a SHORT-TTL special
    // verdict so the next request re-probes instead of blacklisting.
    if ((msg.includes('rate') || msg.includes('429') || msg.includes('blocked') ||
         msg.includes('bot') || msg.includes('temporarily')) &&
        (Date.now() - lastChadBlockAt < 30_000)) {
      verdicts.set(`${slug}:${ep}:${name}:${type}`, { ok: true, at: Date.now() - (PROBE_TTL_OK - 20_000), ms: 0 })
      return { ok: true, ms: 0 }
    }
    return { ok: false, ms: Date.now() - t0, why: msg }
  }
}

/**
 * Verify all listed providers for THIS title. Returns the SAME array with
 * `_healthy` set from live verdicts (false = verified dead for this title).
 * Concurrency-capped + serial-batched; unknown servers are probed, cached
 * verdicts are served instantly.
 */
export async function verifyProviders(providers, { anilistId, slug, ep, titles = {} }) {
  if (!Array.isArray(providers) || providers.length === 0) return providers
  pruneVerdicts()

  const needsProbe = []
  for (const p of providers) {
    const key = `${slug}:${ep}:${p.name}:${p.type}`
    const cached = verdicts.get(key)
    if (cached) {
      p._healthy = cached.ok
      p._healthMs = cached.ms ?? null
      p._healthError = cached.ok ? null : (cached.why || 'Verified dead for this title')
    } else {
      p._healthy = null // unknown — probe below
      needsProbe.push(p)
    }
  }

  if (needsProbe.length > 0) {
    // ── Don't probe during a chad block window ──
    // When chad is bot-blocked/429'd, EVERY probe "fails" — not because the
    // servers are dead but because the API can't answer. Blacklisting 20
    // servers on a rate-limit hiccup is the exact "everything broken" bug.
    // SKIP probing entirely and mark everything optimistic; the next
    // request (after the block clears) does the real verification.
    const { isChadBlocked, isChad429Blocked } = await import('./anidap.js')
    if (isChadBlocked() || isChad429Blocked()) {
      for (const p of needsProbe) {
        p._healthy = true
        p._healthError = null
      }
      return providers
    }

    // Cap the batch: probing 20 servers serially would hold the route for
    // minutes. Unprobed extras stay `_healthy:null` (treated as OK by the
    // UI/router) and get verified on the next request.
    //
    // ── Priority pick ──
    // The old batch took the LIST ORDER, which starts with every sub
    // server. On a long-running server the first request verified sub
    // tiles and the dub/hsub servers waited for a later tick — the
    // picker's dub tiles stayed "unknown" while sub servers got probed.
    // Prioritizing the DEFAULT server first keeps the tile the app will
    // auto-select verified on request #1.
    const priority = [...needsProbe].sort((a, b) => {
      const da = a.default ? 0 : 1
      const db = b.default ? 0 : 1
      if (da !== db) return da - db
      return a.type.localeCompare(b.type)
    })
    const batch = priority.slice(0, MAX_PROBES_PER_TICK)
    let index = 0
    const runNext = async () => {
      while (index < batch.length) {
        const p = batch[index++]
        const verdict = await probeServer({
          anilistId, slug, ep, name: p.name, type: p.type, titles,
        })
        verdicts.set(`${slug}:${ep}:${p.name}:${p.type}`, verdict)
        p._healthy = verdict.ok
        p._healthMs = verdict.ms
        p._healthError = verdict.ok ? null : (verdict.why || 'Verified dead for this title')
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, batch.length) }, runNext),
    )
    const probed = batch.filter((p) => p._healthy === true).length
    console.log(
      `[server-verify] ${slug}:ep${ep} — probed ${batch.length}/${needsProbe.length}, ` +
      `${probed} verified OK, ${batch.length - probed} dead`,
    )
  }

  // Anything still unprobed: optimistic (clickable), the router will try it.
  for (const p of providers) {
    if (p._healthy === null || p._healthy === undefined) {
      p._healthy = true
      p._healthError = null
    }
  }
  return providers
}

// Periodic prune so the map stays bounded.
setInterval(pruneVerdicts, 5 * 60_000).unref()
