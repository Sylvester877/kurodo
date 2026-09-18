// DUB-ONLY server benchmark across ~100 titles.
//
// Measures the exact path the Watch page walks, restricted to DUB servers:
//   1. GET /api/anidap/info/:anilistId                        → slug
//   2. GET /api/anidap/servers/:slug/1?anilistId=…            → provider list
//   3. GET /api/anidap/sources/:slug/1/:provider/dub?…&pick=1 → the dub stream
//
// Why `pick=1`: without it the router's automatic megavid fast path may answer
// instead of the named dub server, and megavid itself falls back to SUB when a
// title has no dub — which would report a "working dub server" for something
// that actually served a sub. `pick=1` is what the picker sends when the user
// clicks a chip, so this measures the real, honest dub path.
//
// The title pool is a deliberate spread, not just the top 100: mainstream
// (POPULARITY_DESC), mid-tier (SCORE_DESC deep page) and the long tail
// (POPULARITY ascending). Dub availability is concentrated in the mainstream,
// so a top-100-only sample would flatter the numbers.
//
// Usage:
//   node scripts-perf/dub_bench.mjs [origin] [count] [--all-servers]
//   COUNT default 100 · source timeout 45s · skips nothing (no hidden servers)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5173'
const COUNT = Number((process.argv[3] || '100').replace(/^--.*/, '')) || 100
const ALL_SERVERS = process.argv.includes('--all-servers')
const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 45_000)
const OUT_JSON = path.join(ROOT, 'screenshots', 'dub-bench-results.json')

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

// ── Title pool: three strata, interleaved so progress output shows a mix ──
// AniList hard-caps `perPage` at 50 — anything larger comes back as a
// validation error with `data: null`, which silently produced an empty pool
// the first time this bench ran. Page through instead.
const PER_PAGE = 50
const MEDIA_FIELDS = 'id idMal popularity averageScore episodes format title { english romaji }'
const mkQuery = (sort, extra = '') =>
  `query ($page: Int, $perPage: Int) { Page(page: $page, perPage: $perPage) { media(type: ANIME, sort: ${sort}, isAdult: false${extra}) { ${MEDIA_FIELDS} } } }`

const Q_DESC = mkQuery('POPULARITY_DESC', ', format_in: [TV, TV_SHORT, ONA, OVA, MOVIE]')
const Q_SCORE = mkQuery('SCORE_DESC', ', episodes_greater: 3, format_in: [TV, ONA, OVA]')
const Q_ASC = mkQuery('POPULARITY', ', averageScore_greater: 62, episodes_greater: 4, format_in: [TV, ONA, OVA]')

async function gql(query, page) {
  try {
    const r = await fetch(`${ORIGIN}/api/anilist-gql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { page, perPage: PER_PAGE } }),
    })
    const j = await r.json()
    if (j?.errors?.length) {
      console.warn(`[dub-bench] AniList page ${page}: ${j.errors[0]?.message?.slice(0, 90)}`)
      return []
    }
    return j?.data?.Page?.media || []
  } catch {
    return []
  }
}

/** Pull `pages` pages of one sort, sequentially (the relay is rate-limited). */
async function gqlPages(query, pages, startPage = 1) {
  const out = []
  for (let p = startPage; p < startPage + pages; p++) out.push(...(await gql(query, p)))
  return out
}

const [mainstream, midtier, longtail] = await Promise.all([
  gqlPages(Q_DESC, 2),
  gqlPages(Q_SCORE, 2, 4),
  gqlPages(Q_ASC, 2),
])

const seen = new Set()
const picks = []
// Interleave the strata round-robin so every prefix of the run is represent-
// ative (a run cut short by a session end is still a valid sample).
const strata = [mainstream, midtier, longtail]
for (let i = 0; picks.length < COUNT && i < 400; i++) {
  for (const s of strata) {
    if (picks.length >= COUNT) break
    const m = s[i]
    if (!m?.idMal || seen.has(m.idMal)) continue
    seen.add(m.idMal)
    picks.push(m)
  }
}

if (picks.length === 0) {
  console.log('Could not fetch a title pool from AniList — aborting.')
  process.exit(1)
}

console.log(`═ DUB SERVER BENCH — ${picks.length} titles (mainstream / mid-tier / long tail) ═`)
console.log(`origin ${ORIGIN} · source timeout ${SOURCE_TIMEOUT_MS / 1000}s · ${ALL_SERVERS ? 'ALL dub servers per title' : 'all listed dub servers (max 12)'} · pick=1 (honest dub path)`)

// ── Scoreboard ──
const board = new Map()
function slot(name) {
  return board.get(name) || { ok: 0, fail: 0, msSum: 0, msN: 0, subs: 0, okMs: 0, errs: new Map() }
}
function note(name, ok, ms, subs) {
  const b = slot(name)
  if (ok) { b.ok++; b.okMs += ms } else b.fail++
  if (ms > 0) { b.msSum += ms; b.msN++ }
  if (subs > 0) b.subs++
  board.set(name, b)
}
function noteErr(name, message) {
  const b = slot(name)
  const k = String(message || '').slice(0, 56)
  b.errs.set(k, (b.errs.get(k) || 0) + 1)
  board.set(name, b)
}

const rows = []
let noDubListed = 0
let noSlug = 0
let tInfoAll = 0
let tServersAll = 0
let tSourceAll = 0
const startedAt = Date.now()

function printScoreboard(label) {
  console.log(`\n── DUB SERVER SCOREBOARD (${label}) ──`)
  const sorted = [...board.entries()].sort(
    (a, b) =>
      b[1].ok / Math.max(1, b[1].ok + b[1].fail) - a[1].ok / Math.max(1, a[1].ok + a[1].fail),
  )
  for (const [name, b] of sorted) {
    const total = b.ok + b.fail
    const rate = total ? Math.round((b.ok / total) * 100) : 0
    const avg = b.msN ? (b.msSum / b.msN / 1000).toFixed(2) : '-'
    const okAvg = b.ok ? (b.okMs / b.ok / 1000).toFixed(2) : '-'
    const top = [...b.errs.entries()].sort((x, y) => y[1] - x[1])[0]
    console.log(
      `  ${String(name).padEnd(15)} ${String(rate + '%').padStart(4)}  ok ${String(b.ok).padStart(3)} / fail ${String(b.fail).padStart(3)}  all-avg ${String(avg).padStart(5)}s  ok-avg ${String(okAvg).padStart(5)}s  subs ${b.subs}${top ? `  · mostly: ${top[0]}` : ''}`,
    )
  }
}

for (const [i, m] of picks.entries()) {
  const title = m.title.english || m.title.romaji
  const tag = `[${String(i + 1).padStart(3)}/${picks.length}]`
  const info = await json(`/api/anidap/info/${m.id}`)
  tInfoAll += info.ms
  const slug = info.body?.data?.slug || info.body?.slug || null
  if (!slug) {
    noSlug++
    console.log(`${tag} ${title.slice(0, 44).padEnd(46)} NO SLUG (info ${info.status} in ${(info.ms / 1000).toFixed(2)}s)`)
    rows.push({ title, malId: m.idMal, slug: null })
    continue
  }

  const servers = await json(`/api/anidap/servers/${encodeURIComponent(slug)}/1?anilistId=${m.id}`)
  tServersAll += servers.ms
  const all = servers.body?.data?.providers || []
  const dub = all.filter((p) => p.type === 'dub')
  if (dub.length === 0) {
    noDubListed++
    console.log(`${tag} ${title.slice(0, 44).padEnd(46)} slug ${(info.ms / 1000).toFixed(2)}s · servers ${(servers.ms / 1000).toFixed(2)}s · ${all.length} listed / 0 DUB`)
    rows.push({ title, malId: m.idMal, dubListed: 0, results: [] })
    continue
  }

  const list = ALL_SERVERS ? dub : dub.slice(0, 12)
  console.log(`${tag} ${title.slice(0, 44).padEnd(46)} slug ${(info.ms / 1000).toFixed(2)}s · servers ${(servers.ms / 1000).toFixed(2)}s · ${all.length} listed / ${dub.length} DUB`)

  const results = []
  for (const p of list) {
    const url = `/api/anidap/sources/${encodeURIComponent(slug)}/1/${encodeURIComponent(p.name)}/dub?anilistId=${m.id}&malId=${m.idMal}&pick=1`
    const s = await json(url, SOURCE_TIMEOUT_MS)
    tSourceAll += s.ms
    const d = s.body?.data
    const streamUrl = d?.url || d?.raw || null
    const subs = Array.isArray(d?.subtitles) ? d.subtitles.length : Array.isArray(d?.tracks) ? d.tracks.length : 0
    const ok = s.status === 200 && !!streamUrl
    note(p.name, ok, s.ms, subs)
    if (!ok) noteErr(p.name, s.body?.message || s.body?.error || `HTTP ${s.status}`)
    results.push({ name: p.name, ok, ms: s.ms, subs, why: s.body?.message || s.body?.error || `HTTP ${s.status}` })
    console.log(`      ${ok ? '✓' : '✗'} ${String(p.name).padEnd(14)} dub ${(s.ms / 1000).toFixed(2).padStart(6)}s  ${ok ? `${subs} subs  ${String(streamUrl).slice(0, 58)}` : String(results.at(-1).why).slice(0, 52)}`)
  }
  rows.push({ title, malId: m.idMal, dubListed: dub.length, results })

  // Rolling scoreboard every 10 titles so a long run stays readable live.
  if ((i + 1) % 10 === 0) {
    printScoreboard(`after ${i + 1} titles · ${((Date.now() - startedAt) / 60000).toFixed(1)} min elapsed`)
    fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: true, rows, board: [...board] }, null, 2))
  }
  await sleep(200)
}

printScoreboard('final')

// ── Latency + coverage summary ──
const titlesWithDub = rows.filter((r) => (r.dubListed || 0) > 0).length
const titlesWithWorkingDub = rows.filter((r) => r.results?.some((x) => x.ok)).length
const totalDubCalls = [...board.values()].reduce((n, b) => n + b.ok + b.fail, 0)
const totalDubOk = [...board.values()].reduce((n, b) => n + b.ok, 0)
const totalDubFail = [...board.values()].reduce((n, b) => n + b.fail, 0)
const failMs = [...board.values()].reduce((n, b) => n + (b.msSum - b.okMs), 0)

console.log(`\n══ DUB SUMMARY — ${rows.length} titles · ${((Date.now() - startedAt) / 60000).toFixed(1)} min ══`)
console.log(`  titles with DUB listed            ${titlesWithDub}/${rows.length}`)
console.log(`  titles where a DUB server worked  ${titlesWithWorkingDub}/${rows.length}`)
console.log(`  titles with NO dub listed at all  ${noDubListed}`)
console.log(`  titles that never resolved a slug ${noSlug}`)
console.log(`  dub source calls                  ${totalDubCalls}  (${totalDubOk} ok / ${totalDubFail} fail → ${totalDubCalls ? Math.round((totalDubOk / totalDubCalls) * 100) : 0}% success)`)
console.log(`  mean fetch: info ${(tInfoAll / rows.length / 1000).toFixed(2)}s · servers ${(tServersAll / rows.length / 1000).toFixed(2)}s · per-dub-source ${totalDubCalls ? (tSourceAll / totalDubCalls / 1000).toFixed(2) : '-'}s (ok ${totalDubOk ? (([...board.values()].reduce((n, b) => n + b.okMs, 0)) / totalDubOk / 1000).toFixed(2) : '-'}s / fail ${totalDubFail ? (failMs / totalDubFail / 1000).toFixed(2) : '-'}s)`)
console.log(`  full results → ${OUT_JSON}`)

fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: false, rows, board: [...board], summary: { titles: rows.length, titlesWithDub, titlesWithWorkingDub, noDubListed, noSlug, totalDubCalls, totalDubOk, totalDubFail } }, null, 2))
console.log('dub bench done')
