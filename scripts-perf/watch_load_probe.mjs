// COLD WATCH-LOAD STAGE PROBE.
//
// The Watch page loads its data in a STRICT SEQUENCE, so the user-felt wait is
// the SUM of the stages, not the slowest one:
//
//   1. GET /api/anidap/info/:anilistId      → slug          (must finish first)
//   2. GET /api/anidap/servers/:slug/:ep    → server list   (needs the slug)
//   3. GET /api/anidap/sources/:slug/...    → the stream    (needs the list)
//
// This times each stage separately and reports the total, so any fix can be
// attributed to a stage instead of guessed at. Run with a freshly restarted
// server so the in-memory caches are cold (that is what a new episode visits).
//
// Usage: node scripts-perf/watch_load_probe.mjs [origin] [anilistId,anilistId,...]
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5173'
const IDS = (process.argv[3] || '21,16498,5114,11061,57555').split(',').map(Number)

async function json(url, timeoutMs = 60_000) {
  const t0 = Date.now()
  try {
    const r = await fetch(ORIGIN + url, { signal: AbortSignal.timeout(timeoutMs) })
    const body = await r.json().catch(() => null)
    return { status: r.status, ms: Date.now() - t0, body }
  } catch (e) {
    return { status: 'ERR:' + e.name, ms: Date.now() - t0, body: null }
  }
}

const s = (ms) => (ms / 1000).toFixed(2) + 's'
const totals = { info: 0, servers: 0, sources: 0, n: 0 }

console.log(`═ COLD WATCH-LOAD STAGES @ ${ORIGIN} ═`)
console.log('  (server restarted before this run → in-memory caches cold)\n')

for (const id of IDS) {
  const info = await json(`/api/anidap/info/${id}`)
  const slug = info.body?.data?.slug || info.body?.slug || null
  if (!slug) {
    console.log(`#${id}  NO SLUG (info ${info.status} in ${s(info.ms)})`)
    continue
  }
  const servers = await json(`/api/anidap/servers/${encodeURIComponent(slug)}/1?anilistId=${id}`)
  const provs = servers.body?.data?.providers || []
  const verified = provs.filter((p) => p._healthy === true).length
  const dead = provs.filter((p) => p._healthy === false).length
  const unknown = provs.filter((p) => p._healthy == null).length

  // The client's capability-first pick is the first chip it would try.
  const ORDER = ['loli', 'yuki', 'neko', 'sora', 'miku', 'mimi', 'kiwi', 'beep',
    'nuri', 'kami', 'koto', 'mochi', 'shiro', 'wave']
  const rank = (n) => {
    const c = String(n).replace(/^anidap-/, '').toLowerCase()
    const i = ORDER.indexOf(c)
    return i === -1 ? 8 : i
  }
  const type = provs.some((p) => p.type === 'dub') ? 'dub' : 'sub'
  const chain = provs.filter((p) => p.type === type).sort((a, b) => rank(a.name) - rank(b.name))
  const first = chain[0]

  let sources = { ms: 0, ok: false, name: null }
  if (first) {
    const r = await json(
      `/api/anidap/sources/${encodeURIComponent(slug)}/1/${encodeURIComponent(first.name)}/${type}?anilistId=${id}&pick=1`,
      45_000,
    )
    sources = { ms: r.ms, ok: r.status === 200 && !!(r.body?.data?.url || r.body?.data?.raw), name: first.name }
  }

  const total = info.ms + servers.ms + sources.ms
  totals.info += info.ms; totals.servers += servers.ms; totals.sources += sources.ms; totals.n += 1
  console.log(
    `#${String(id).padEnd(6)} ${slug.slice(0, 26).padEnd(28)} ` +
    `info ${s(info.ms).padStart(7)} → servers ${s(servers.ms).padStart(7)} → first stream ${s(sources.ms).padStart(7)} ` +
    `= ${s(total).padStart(7)}  ${sources.ok ? '✓' : '✗'} ${sources.name || '-'}(${type})  ` +
    `[${provs.length} listed: ${verified} ok/${unknown} unverified/${dead} dead]`,
  )
}

if (totals.n) {
  console.log(`\n── MEAN PER STAGE (${totals.n} titles) ──`)
  console.log(`  info   (slug resolve)     ${s(totals.info / totals.n)}`)
  console.log(`  servers (chad + verify)   ${s(totals.servers / totals.n)}`)
  console.log(`  first stream extraction   ${s(totals.sources / totals.n)}`)
  console.log(`  TOTAL user-felt wait      ${s((totals.info + totals.servers + totals.sources) / totals.n)}`)
}
