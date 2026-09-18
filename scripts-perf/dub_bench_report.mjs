// Report reader for scripts-perf/dub_bench.mjs output.
//
// Splits failures into two classes, because they mean different things:
//   • RATE-LIMITED  — the site-wide chad 429 window. The server is fine; our
//                     IP was throttled. This says nothing about the server.
//   • REAL FAILURE  — "No stream available for …/dub", verified-dead, timeouts.
// The headline success rate is therefore reported both ways.
//
// Usage: node scripts-perf/dub_bench_report.mjs [path-to-json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const FILE = process.argv[2] || path.join(ROOT, 'screenshots', 'dub-bench-results.json')

const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
const rows = raw.rows || []

const isRateLimited = (why) => /rate.?limited|retry in ~|429/i.test(String(why || ''))
const isTimeout = (why) => /timed out|timeout|abort/i.test(String(why || ''))

const board = new Map()
const slot = (n) => board.get(n) || { ok: 0, real: 0, rl: 0, to: 0, msSum: 0, okMs: 0, realMs: 0, subs: 0, url: new Map() }
for (const r of rows) {
  for (const c of r.results || []) {
    const b = slot(c.name)
    b.msSum += c.ms || 0
    if (c.ok) {
      b.ok++
      b.okMs += c.ms || 0
      if (c.subs > 0) b.subs++
    } else if (isRateLimited(c.why)) b.rl++
    else if (isTimeout(c.why)) b.to++
    else {
      b.real++
      b.realMs += c.ms || 0
    }
    if (c.url) b.url.set(c.url, (b.url.get(c.url) || 0) + 1)
    board.set(c.name, b)
  }
}

const titles = rows.length
const withDub = rows.filter((r) => (r.dubListed || 0) > 0).length
const withWorking = rows.filter((r) => (r.results || []).some((x) => x.ok)).length
const noDub = rows.filter((r) => (r.dubListed || 0) === 0).length
const noSlug = rows.filter((r) => r.slug === null).length

const calls = [...board.values()].reduce((n, b) => n + b.ok + b.real + b.rl + b.to, 0)
const ok = [...board.values()].reduce((n, b) => n + b.ok, 0)
const rl = [...board.values()].reduce((n, b) => n + b.rl, 0)
const to = [...board.values()].reduce((n, b) => n + b.to, 0)
const real = [...board.values()].reduce((n, b) => n + b.real, 0)
const okMs = [...board.values()].reduce((n, b) => n + b.okMs, 0)
const realMs = [...board.values()].reduce((n, b) => n + b.realMs, 0)

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const sec = (ms, n) => (n ? (ms / n / 1000).toFixed(2) + 's' : '-')

console.log(`══ DUB BENCH REPORT — ${FILE} ══`)
console.log(`titles ${titles} · with dub listed ${withDub} · with a WORKING dub server ${withWorking} · no dub listed ${noDub} · no slug ${noSlug}`)
console.log(`dub source calls ${calls}  → ok ${ok} (${pct(ok, calls)}%) · real failures ${real} (${pct(real, calls)}%) · rate-limited ${rl} (${pct(rl, calls)}%) · timeouts ${to}`)
console.log(`success rate excluding rate-limit windows: ${pct(ok, ok + real + to)}%`)
console.log(`mean latency: success ${sec(okMs, ok)} · real failure ${sec(realMs, real)}`)
console.log(`\n── PER DUB SERVER (raw | excluding 429) ──`)
const sorted = [...board.entries()].sort((a, b) => {
  const ra = a[1].ok / Math.max(1, a[1].ok + a[1].real + a[1].to)
  const rb = b[1].ok / Math.max(1, b[1].ok + b[1].real + b[1].to)
  return rb - ra
})
for (const [name, b] of sorted) {
  const rawTotal = b.ok + b.real + b.rl + b.to
  const cleanTotal = b.ok + b.real + b.to
  console.log(
    `  ${name.padEnd(15)} raw ${String(pct(b.ok, rawTotal) + '%').padStart(4)} (${String(b.ok).padStart(3)}/${String(rawTotal).padStart(3)})` +
    `   clean ${String(pct(b.ok, cleanTotal) + '%').padStart(4)} (${String(b.ok).padStart(3)}/${String(cleanTotal).padStart(3)})` +
    `   avg ${sec(b.msSum, rawTotal).padStart(6)}  dead ${String(b.real).padStart(3)}  rl ${String(b.rl).padStart(3)}  to ${String(b.to).padStart(3)}  subs ${b.subs}`,
  )
}

// Duplicate-stream detection: two different server names returning the SAME URL
// means the chip has no independent meaning for that title.
let dupTitles = 0
let dupChips = 0
for (const r of rows) {
  const byUrl = new Map()
  for (const c of r.results || []) if (c.ok && c.url) byUrl.set(c.url, (byUrl.get(c.url) || 0) + 1)
  const dups = [...byUrl.values()].filter((n) => n > 1)
  if (dups.length) {
    dupTitles++
    dupChips += dups.reduce((n, x) => n + x, 0)
  }
}
console.log(`\n── DUPLICATE STREAMS ──`)
console.log(`  ${dupTitles}/${withWorking} titles with a working dub had 2+ chips serving the IDENTICAL url (${dupChips} chips share a url)`)

// Failure reasons, grouped
const reasons = new Map()
for (const r of rows) for (const c of r.results || []) if (!c.ok) reasons.set(String(c.why).slice(0, 60), (reasons.get(String(c.why).slice(0, 60)) || 0) + 1)
console.log(`\n── FAILURE REASONS ──`)
for (const [why, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${why}`)

// Titles with a dub listed but NOTHING working (the "picker lied" cases)
const bad = rows.filter((r) => (r.dubListed || 0) > 0 && !(r.results || []).some((x) => x.ok))
console.log(`\n── TITLES WITH DUB LISTED BUT NO WORKING DUB (${bad.length}) ──`)
for (const r of bad.slice(0, 25)) console.log(`  · ${String(r.title).slice(0, 46).padEnd(48)} listed ${r.dubListed}`)
if (bad.length > 25) console.log(`  … and ${bad.length - 25} more (see ${path.basename(FILE)})`)
