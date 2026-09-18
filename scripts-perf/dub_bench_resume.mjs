// Resume the 100-title DUB bench from where /tmp/dub_bench.log left off (70/100).
// Re-uses the exact same picks logic as dub_bench.mjs, but skips titles already
// recorded in screenshots/dub-bench-results.json + /tmp/dub_bench.log so the
// rate-limited tail is not re-counted. Honest dub path: pick=1. 429-aware: when
// chad returns Retry ~Xs, sleep that long + 3s before the next chip, and sleep
// 2s between healthy calls so we don't re-trip the site-wide limiter on the
// resume.
//
// Usage: node scripts-perf/dub_bench_resume.mjs [origin]
// Writes back to screenshots/dub-bench-results.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5173'
const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 45_000)
const OUT_JSON = path.join(ROOT, 'screenshots', 'dub-bench-results.json')
const LOG_PATH = '/tmp/dub_bench.log'
const RESUME_LOG = '/tmp/dub_bench_resume.log'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const parseRetry = (msg) => {
  const m = String(msg).match(/Retry in ~(\d+)s/)
  return m ? Number(m[1]) : 0
}

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
    if (j?.errors?.length) return []
    return j?.data?.Page?.media || []
  } catch { return [] }
}
async function gqlPages(query, pages, startPage = 1) {
  const out = []
  for (let p = startPage; p < startPage + pages; p++) out.push(...(await gql(query, p)))
  return out
}

console.log(`[resume] rebuilding picks via ${ORIGIN}/api/anilist-gql …`)
const [mainstream, midtier, longtail] = await Promise.all([gqlPages(Q_DESC, 2), gqlPages(Q_SCORE, 2, 4), gqlPages(Q_ASC, 2)])
const seen = new Set()
const picks = []
const strata = [mainstream, midtier, longtail]
for (let i = 0; picks.length < 100 && i < 400; i++) {
  for (const s of strata) {
    if (picks.length >= 100) break
    const m = s[i]
    if (!m?.idMal || seen.has(m.idMal)) continue
    seen.add(m.idMal)
    picks.push(m)
  }
}
console.log(`[resume] picks rebuilt: ${picks.length} titles`)

// Load existing results
let existing = { rows: [], board: [] }
try { existing = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')) } catch {}
const doneMal = new Set((existing.rows || []).map(r => r.malId))
// Also parse the raw log for titles that were started but not yet flushed to JSON (60 -> 70)
try {
  const log = fs.readFileSync(LOG_PATH, 'utf8')
  for (const line of log.split('\n')) {
    const m = line.match(/malId=(\d+)/)
    // alternative: rows push includes malId but log titles don't carry malId — instead
    // parse the per-title header: "[ 68/100] Space Brothers  slug …"
    // We can't get malId from the header alone, so rely on JSON for dedupe and
    // re-derive remaining picks by index: JSON has rows in picks order, so index = rows.length
  }
} catch {}

const startIdx = (existing.rows || []).length
console.log(`[resume] existing rows ${startIdx} — resuming at picks[${startIdx}] (#${startIdx + 1}/100)`)
if (startIdx >= 100) { console.log('[resume] already complete'); process.exit(0) }

// Rehydrate board
const board = new Map(existing.board || [])
function slot(name) { return board.get(name) || { ok: 0, fail: 0, msSum: 0, msN: 0, subs: 0, okMs: 0, errs: new Map(Object.entries({})) } }
function note(name, ok, ms, subs) {
  const b = board.get(name) || { ok: 0, fail: 0, msSum: 0, msN: 0, subs: 0, okMs: 0, errs: new Map() }
  // errs may have been serialized as array
  if (Array.isArray(b.errs)) b.errs = new Map(b.errs)
  if (!(b.errs instanceof Map)) b.errs = new Map(Object.entries(b.errs || {}))
  if (ok) { b.ok++; b.okMs += ms } else b.fail++
  if (ms > 0) { b.msSum += ms; b.msN++ }
  if (subs > 0) b.subs++
  board.set(name, b)
}
function noteErr(name, message) {
  const b = board.get(name) || { ok: 0, fail: 0, msSum: 0, msN: 0, subs: 0, okMs: 0, errs: new Map() }
  if (Array.isArray(b.errs)) b.errs = new Map(b.errs)
  if (!(b.errs instanceof Map)) b.errs = new Map(Object.entries(b.errs || {}))
  const k = String(message || '').slice(0, 56)
  b.errs.set(k, (b.errs.get(k) || 0) + 1)
  board.set(name, b)
}
// normalize any serialized board entries (Map -> array during JSON)
for (const [k, v] of [...board.entries()]) {
  if (Array.isArray(v.errs)) v.errs = new Map(v.errs)
  else if (v.errs && !(v.errs instanceof Map)) v.errs = new Map(Object.entries(v.errs))
}

let noDubListed = 0, noSlug = 0
let tInfoAll = 0, tServersAll = 0, tSourceAll = 0
// account for already-counted timing from existing rows: not stored, so fresh totals are resume-only
const rows = existing.rows || []
const startedAt = Date.now()

function printScoreboard(label) {
  console.log(`\n── DUB SCOREBOARD (${label}) ──`)
  const sorted = [...board.entries()].sort((a,b)=> b[1].ok/Math.max(1,b[1].ok+b[1].fail) - a[1].ok/Math.max(1,a[1].ok+a[1].fail))
  for (const [name, b] of sorted) {
    const total=b.ok+b.fail, rate=total?Math.round(b.ok/total*100):0
    const avg=b.msN?(b.msSum/b.msN/1000).toFixed(2):'-'
    const okAvg=b.ok?(b.okMs/b.ok/1000).toFixed(2):'-'
    const top=[... (b.errs instanceof Map? b.errs: new Map(Object.entries(b.errs||{}))).entries()].sort((x,y)=>y[1]-x[1])[0]
    console.log(`  ${String(name).padEnd(15)} ${String(rate+'%').padStart(4)}  ok ${String(b.ok).padStart(3)} / fail ${String(b.fail).padStart(3)}  all-avg ${String(avg).padStart(5)}s  ok-avg ${String(okAvg).padStart(5)}s  subs ${b.subs}${top?`  · mostly: ${top[0]}`:''}`)
  }
}

const resumeStartedIdx = startIdx
for (let i = resumeStartedIdx; i < picks.length; i++) {
  const m = picks[i]
  const title = m.title.english || m.title.romaji
  const tag = `[${String(i+1).padStart(3)}/${picks.length}]`
  const info = await json(`/api/anidap/info/${m.id}`)
  tInfoAll += info.ms
  const slug = info.body?.data?.slug || info.body?.slug || null
  if (!slug) {
    noSlug++
    console.log(`${tag} ${title.slice(0,44).padEnd(46)} NO SLUG (info ${info.status} in ${(info.ms/1000).toFixed(2)}s)`)
    rows.push({ title, malId: m.idMal, slug: null })
    fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: true, rows, board: [...board].map(([k,v])=>[k,{...v, errs:[... (v.errs instanceof Map? v.errs: new Map(Object.entries(v.errs||{}))).entries()]}]) }, null, 2))
    continue
  }
  const servers = await json(`/api/anidap/servers/${encodeURIComponent(slug)}/1?anilistId=${m.id}`)
  tServersAll += servers.ms
  const all = servers.body?.data?.providers || []
  const dub = all.filter(p=>p.type==='dub')
  if (dub.length===0) {
    noDubListed++
    console.log(`${tag} ${title.slice(0,44).padEnd(46)} slug ${(info.ms/1000).toFixed(2)}s · servers ${(servers.ms/1000).toFixed(2)}s · ${all.length} listed / 0 DUB`)
    rows.push({ title, malId: m.idMal, dubListed: 0, results: [] })
    fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: true, rows, board: [...board].map(([k,v])=>[k,{...v, errs:[... (v.errs instanceof Map? v.errs: new Map(Object.entries(v.errs||{}))).entries()]}]) }, null, 2))
    continue
  }
  const list = dub.slice(0,12)
  console.log(`${tag} ${title.slice(0,44).padEnd(46)} slug ${(info.ms/1000).toFixed(2)}s · servers ${(servers.ms/1000).toFixed(2)}s · ${all.length} listed / ${dub.length} DUB`)
  const results=[]
  for (const p of list) {
    const url = `/api/anidap/sources/${encodeURIComponent(slug)}/1/${encodeURIComponent(p.name)}/dub?anilistId=${m.id}&malId=${m.idMal}&pick=1`
    const s = await json(url, SOURCE_TIMEOUT_MS)
    tSourceAll += s.ms
    const d = s.body?.data
    const streamUrl = d?.url || d?.raw || null
    const subs = Array.isArray(d?.subtitles)? d.subtitles.length : Array.isArray(d?.tracks)? d.tracks.length : 0
    const ok = s.status===200 && !!streamUrl
    note(p.name, ok, s.ms, subs)
    if(!ok) noteErr(p.name, s.body?.message || s.body?.error || `HTTP ${s.status}`)
    results.push({ name:p.name, ok, ms:s.ms, subs, why: s.body?.message||s.body?.error||`HTTP ${s.status}` })
    console.log(`      ${ok?'✓':'✗'} ${String(p.name).padEnd(14)} dub ${(s.ms/1000).toFixed(2).padStart(6)}s  ${ok?`${subs} subs  ${String(streamUrl).slice(0,58)}`:String(results.at(-1).why).slice(0,62)}`)
    const retry = parseRetry(s.body?.message || s.body?.error || '')
    if (retry) {
      const wait = retry*1000 + 3000
      console.log(`      ↻ chad 429 — sleeping ${(wait/1000).toFixed(0)}s before next chip…`)
      await sleep(wait)
    } else {
      await sleep(1200)
    }
  }
  rows.push({ title, malId: m.idMal, dubListed: dub.length, results })
  if ((i+1)%10===0) {
    printScoreboard(`after ${i+1} titles · ${((Date.now()-startedAt)/60000).toFixed(1)} min elapsed (resume)`)
  }
  fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: true, rows, board: [...board].map(([k,v])=>[k,{...v, errs:[... (v.errs instanceof Map? v.errs: new Map(Object.entries(v.errs||{}))).entries()]}]) }, null, 2))
  // extra breather between titles
  await sleep(800)
}

printScoreboard('final (resume)')
const titlesWithDub = rows.filter(r=>(r.dubListed||0)>0).length
const titlesWithWorkingDub = rows.filter(r=>r.results?.some(x=>x.ok)).length
const totalDubCalls = [...board.values()].reduce((n,b)=>n+b.ok+b.fail,0)
const totalDubOk = [...board.values()].reduce((n,b)=>n+b.ok,0)
const totalDubFail = [...board.values()].reduce((n,b)=>n+b.fail,0)
const failMs = [...board.values()].reduce((n,b)=>n+(b.msSum-b.okMs),0)
console.log(`\n══ DUB SUMMARY (resume) — ${rows.length} titles · ${((Date.now()-startedAt)/60000).toFixed(1)} min (this segment) ══`)
console.log(`  titles with DUB listed            ${titlesWithDub}/${rows.length}`)
console.log(`  titles where a DUB server worked  ${titlesWithWorkingDub}/${rows.length}`)
console.log(`  resume: titles with NO dub listed ${noDubListed}  never-resolved slug ${noSlug}`)
console.log(`  dub source calls (all time)       ${totalDubCalls}  (${totalDubOk} ok / ${totalDubFail} fail → ${totalDubCalls?Math.round(totalDubOk/totalDubCalls*100):0}% success)`)
console.log(`  full results → ${OUT_JSON}`)
fs.writeFileSync(OUT_JSON, JSON.stringify({ partial:false, rows, board:[...board].map(([k,v])=>[k,{...v, errs:[... (v.errs instanceof Map? v.errs: new Map(Object.entries(v.errs||{}))).entries()]}]) , summary:{ titles: rows.length, titlesWithDub, titlesWithWorkingDub, totalDubCalls, totalDubOk, totalDubFail } }, null, 2))
console.log('dub bench resume done')
