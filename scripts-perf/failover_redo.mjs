// UNCAPPED RE-PROBE of the titles that never played.
//
// failover_bench.mjs stops its chain at CHAIN_CAP=8 chips per track, so a
// "never played" verdict could mean either:
//   (a) no upstream stream exists on either track — not client-fixable, or
//   (b) a working server sat at chain position 9+ and was never reached.
// Those two are completely different answers to "can this be 100%?", so this
// script removes the cap entirely and tries EVERY listed server on BOTH
// tracks until something plays or the list is genuinely exhausted.
//
// Reads screenshots/failover-bench-results.json, re-probes only the failures,
// writes screenshots/failover-redo-results.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5173'
const IN_JSON = path.join(ROOT, 'screenshots', 'failover-bench-results.json')
const OUT_JSON = path.join(ROOT, 'screenshots', 'failover-redo-results.json')
const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 45_000)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

async function waitOutRateLimit() {
  for (let i = 0; i < 40; i++) {
    const h = await json('/api/health', 10_000)
    const d = h.body?.data || h.body
    if (!d?.isRateLimited) return
    const sec = Number(d?.rateLimitRemaining || 0)
    const wait = Math.min(Math.max(sec, 5) * 1000 + 2000, 45_000)
    console.log(`      … chad rate-limited, waiting ${Math.round(wait / 1000)}s`)
    await sleep(wait)
  }
}

const prev = JSON.parse(fs.readFileSync(IN_JSON, 'utf8'))
const failures = prev.rows.filter((r) => r.slug && !r.played)
console.log(`═ UNCAPPED RE-PROBE — ${failures.length} titles that never played (no chain cap) ═\n`)

const rows = []
const startedAt = Date.now()

for (const [i, f] of failures.entries()) {
  const tag = `[${String(i + 1).padStart(2)}/${failures.length}]`
  const servers = await json(`/api/anidap/servers/${encodeURIComponent(f.slug)}/1?anilistId=${f.id}`)
  const all = servers.body?.data?.providers || []
  const dub = all.filter((p) => p.type === 'dub')
  const sub = all.filter((p) => p.type === 'sub')
  const rosterOnly = all.every((p) => p._roster)

  const tried = []
  let served = null
  // Both tracks, every listed server, no cap. Dub first (the bench's track).
  for (const type of ['dub', 'sub']) {
    const list = type === 'dub' ? dub : sub
    for (const p of list) {
      await waitOutRateLimit()
      const url = `/api/anidap/sources/${encodeURIComponent(f.slug)}/1/${encodeURIComponent(p.name)}/${type}?anilistId=${f.id}&malId=${f.malId}&pick=1`
      const s = await json(url, SOURCE_TIMEOUT_MS)
      const d = s.body?.data
      const streamUrl = d?.url || d?.raw || null
      const ok = s.status === 200 && !!streamUrl
      tried.push({ type, name: p.name, ok, ms: s.ms, why: s.body?.message || s.body?.error || `HTTP ${s.status}` })
      if (ok) { served = { type, name: p.name }; break }
      await sleep(150)
    }
    if (served) break
  }

  rows.push({
    title: f.title, id: f.id, malId: f.malId, slug: f.slug,
    listedDub: dub.length, listedSub: sub.length, rosterOnly,
    chipsTried: tried.length,
    played: !!served,
    servedBy: served ? `${served.name} (${served.type})` : null,
    why: served ? null : (tried[tried.length - 1]?.why || 'failed'),
    tried,
  })

  console.log(
    `${tag} ${f.title.slice(0, 40).padEnd(42)} ${served ? `✓ NOW PLAYS via ${served.name} (${served.type})` : `✗ dead on all ${tried.length} chips${rosterOnly ? ' · roster-only list' : ''}`}`,
  )
  if ((i + 1) % 5 === 0) {
    const p = rows.filter((r) => r.played).length
    console.log(`\n   … ${i + 1}/${failures.length} re-probed · revived ${p} · ${((Date.now() - startedAt) / 60000).toFixed(1)} min\n`)
    fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: true, rows }, null, 2))
  }
  await sleep(200)
}

const revived = rows.filter((r) => r.played)
const dead = rows.filter((r) => !r.played)
const rosterOnly = dead.filter((r) => r.rosterOnly)

console.log(`\n══ UNCAPPED RE-PROBE SUMMARY — ${((Date.now() - startedAt) / 60000).toFixed(1)} min ══`)
console.log(`  titles re-probed                      ${rows.length}`)
console.log(`  REVIVED by removing the chain cap     ${revived.length}`)
for (const r of revived) console.log(`    ✓ ${r.title.slice(0, 44).padEnd(46)} via ${r.servedBy} (chain position ${r.chipsTried})`)
console.log(`  genuinely dead upstream (both tracks) ${dead.length}`)
console.log(`    · of those, chad listed NOTHING (roster-only guess) ${rosterOnly.length}`)
console.log(`    · chad DID list servers, all dead                    ${dead.length - rosterOnly.length}`)
console.log(`\n  => with the cap removed, title success would be ${100 - dead.length}% not ${100 - rows.length}%`)
fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: false, rows, summary: {
  reProbed: rows.length, revived: revived.length, dead: dead.length, rosterOnlyGuess: rosterOnly.length,
} }, null, 2))
console.log(`  full results → ${OUT_JSON}`)
console.log('uncapped re-probe done')
