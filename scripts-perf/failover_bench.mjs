// TITLE-LEVEL FAILOVER BENCHMARK — "did the episode actually play?"
//
// The old benches (servers_bench.mjs, dub_bench.mjs) measured PER-CHIP success:
// 100 titles × every server, every chip recorded independently. That is the
// right tool for ranking servers, but it is NOT the number a user feels. A user
// feels only one thing: I clicked play, did I get a stream?
//
// This bench walks the SAME chain the Watch page now walks:
//   1. GET /api/anidap/servers/:slug/1     → the listed providers
//   2. order them the way `sortProviders` does (mirrored below — see
//      PROVIDER_PRIORITY, which must stay in sync with src/lib/providers.ts)
//   3. try them ONE AT A TIME with pick=1 until one returns a stream
//   4. if the whole requested track is exhausted, cross to the other audio
//      track once — exactly the client's new last resort
//
// It stops at the FIRST working server per title (that is what the app does),
// so it is also a latency measurement: `ms to first play` is the number that
// matters, not the average of every chip.
//
// Honest ceiling: a title with no upstream stream on EITHER track cannot be
// made to play by any client-side change. Those are reported separately
// (`trulyUnavailable`) instead of being hidden inside an average.
//
// Usage: node scripts-perf/failover_bench.mjs [origin] [count] [--track=dub|sub|prefer]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5173'
const COUNT = Number((process.argv[3] || '100').replace(/^--.*/, '')) || 100
const TRACK = (process.argv.find((a) => a.startsWith('--track=')) || '--track=prefer').split('=')[1]
const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 45_000)
// How many chips the chain will try per track before moving on. The app's real
// ceiling is the whole list + 2; the bench bounds it so a 100-title run
// finishes inside a session. Any title that would have needed chip #9 is
// counted as a chain-limit miss, not silently as an upstream miss.
const CHAIN_CAP = Number(process.env.CHAIN_CAP || 8)
const OUT_JSON = path.join(ROOT, 'screenshots', 'failover-bench-results.json')

// Mirror of PROVIDER_META priorities in src/lib/providers.ts — measured
// per-chip capability, best first. Kept here (not imported) because that table
// is TypeScript; if it changes, change this too. Only ORDER matters to the
// chain, so a drifted value costs accuracy, not correctness.
const PROVIDER_PRIORITY = {
  loli: 0, yuki: 1, neko: 2, sora: 3, miku: 4, mimi: 5, kiwi: 6, beep: 7,
  nuri: 9, kami: 9, koto: 9, mochi: 9, shiro: 9, wave: 9,
}
const priorityOf = (name) =>
  PROVIDER_PRIORITY[String(name).replace(/^anidap-/i, '').toLowerCase()] ?? 8

/** sortProviders equivalent: alive first is n/a (bench has no verdicts), so
 *  the chain is provider capability then name — deterministic, matching the
 *  client for the unverified case the long tail actually hits. */
function orderChain(list) {
  return [...list].sort((a, b) => {
    const pa = priorityOf(a.name)
    const pb = priorityOf(b.name)
    if (pa !== pb) return pa - pb
    return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase())
  })
}

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

// ── Title pool: three strata, interleaved (same shape as dub_bench) ──
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
  } catch {
    return []
  }
}
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

// Rate-limit aware sleep: if the backend reports a chad window, wait it out
// rather than burning the whole run into 429s (that is what killed the first
// dub bench at 70/100).
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

console.log(`═ FAILOVER BENCH — ${picks.length} titles · track=${TRACK} · chain cap ${CHAIN_CAP} ═`)
console.log(`origin ${ORIGIN} · pick=1 (real chip path) · stops at FIRST working server`)

/** Try one audio track end-to-end. Returns {ok, tries, ms, name, why}. */
async function tryTrack({ title, malId, id, slug, type, list }) {
  const chain = orderChain(list)
  const tries = []
  const t0 = Date.now()
  for (const p of chain.slice(0, CHAIN_CAP)) {
    await waitOutRateLimit()
    const url = `/api/anidap/sources/${encodeURIComponent(slug)}/1/${encodeURIComponent(p.name)}/${type}?anilistId=${id}&malId=${malId}&pick=1`
    const s = await json(url, SOURCE_TIMEOUT_MS)
    const d = s.body?.data
    const streamUrl = d?.url || d?.raw || null
    const ok = s.status === 200 && !!streamUrl
    tries.push({ name: p.name, ok, ms: s.ms, subs: Array.isArray(d?.subtitles) ? d.subtitles.length : 0 })
    if (ok) {
      return { ok: true, tries, ms: Date.now() - t0, name: p.name, type }
    }
    await sleep(150)
  }
  return { ok: false, tries, ms: Date.now() - t0, name: null, type }
}

const rows = []
const startedAt = Date.now()

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0 }

for (const [i, m] of picks.entries()) {
  const title = m.title.english || m.title.romaji
  const tag = `[${String(i + 1).padStart(3)}/${picks.length}]`
  const info = await json(`/api/anidap/info/${m.id}`)
  const slug = info.body?.data?.slug || info.body?.slug || null
  if (!slug) {
    console.log(`${tag} ${title.slice(0, 42).padEnd(44)} NO SLUG (info ${info.status})`)
    rows.push({ title, id: m.id, malId: m.idMal, slug: null, played: false, reason: 'no-slug' })
    continue
  }

  const servers = await json(`/api/anidap/servers/${encodeURIComponent(slug)}/1?anilistId=${m.id}`)
  const all = servers.body?.data?.providers || []
  const dub = all.filter((p) => p.type === 'dub')
  const sub = all.filter((p) => p.type === 'sub')

  // Which track do we ask for first? `prefer` = dub when the title lists dub
  // (that is what the app does with preferDub on), else sub.
  let primary
  if (TRACK === 'dub') primary = 'dub'
  else if (TRACK === 'sub') primary = 'sub'
  else primary = dub.length > 0 ? 'dub' : 'sub'

  const trackList = (t) => (t === 'dub' ? dub : sub)
  let first = await tryTrack({ title, malId: m.idMal, id: m.id, slug, type: primary, list: trackList(primary) })
  let crossed = false
  let crossResult = null

  if (!first.ok) {
    const other = primary === 'dub' ? 'sub' : 'dub'
    if (trackList(other).length > 0) {
      crossed = true
      crossResult = await tryTrack({ title, malId: m.idMal, id: m.id, slug, type: other, list: trackList(other) })
    }
  }

  const played = first.ok || !!crossResult?.ok
  const served = first.ok ? first : crossResult
  const chipsTried = first.tries.length + (crossResult?.tries.length || 0)
  const totalMs = first.ms + (crossResult?.ms || 0)

  rows.push({
    title, id: m.id, malId: m.idMal, slug,
    primaryTrack: primary,
    dubListed: dub.length, subListed: sub.length,
    played,
    servedBy: served?.name || null,
    servedTrack: served?.type || null,
    crossedTracks: crossed,
    chipPosition: served ? (first.ok ? first.tries.findIndex((t) => t.ok) + 1 : first.tries.length + crossResult.tries.findIndex((t) => t.ok) + 1) : null,
    chipIndexInChain: served?.name ? orderChain(trackList(served.type)).findIndex((p) => p.name === served.name) + 1 : null,
    chipsTried,
    msToPlay: played ? totalMs : null,
    attempts: [...first.tries, ...(crossResult?.tries || [])],
  })

  const mark = played ? (crossed ? '✓~' : '✓') : '✗'
  const detail = played
    ? `${(totalMs / 1000).toFixed(2)}s · chip ${served.name}${crossed ? ` (${served.type} cross)` : ''}`
    : `${chipsTried} chips failed · ${all.length} listed (${dub.length} dub / ${sub.length} sub)`
  console.log(`${tag} ${title.slice(0, 42).padEnd(44)} ${mark}  ${detail}`)

  if ((i + 1) % 10 === 0) {
    const done = rows.filter((r) => r.slug)
    const playedRows = done.filter((r) => r.played)
    const msAvg = playedRows.length ? playedRows.reduce((n, r) => n + (r.msToPlay || 0), 0) / playedRows.length : 0
    console.log(`\n── CHECKPOINT ${i + 1}/${picks.length} · ${((Date.now() - startedAt) / 60000).toFixed(1)} min ──`)
    console.log(`   title success ${playedRows.length}/${done.length} (${pct(playedRows.length, done.length)}%) · mean time-to-play ${(msAvg / 1000).toFixed(2)}s`)
    const firstChip = playedRows.filter((r) => (r.chipIndexInChain || 99) === 1).length
    console.log(`   served by the FIRST chip in the chain ${firstChip}/${playedRows.length} (${pct(firstChip, playedRows.length)}%)\n`)
    fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: true, rows }, null, 2))
  }
  await sleep(200)
}

// ── Summary ──
const resolved = rows.filter((r) => r.slug)
const played = resolved.filter((r) => r.played)
const crossOnly = played.filter((r) => r.crossedTracks)
const trulyStuck = resolved.filter((r) => !r.played)
const msArr = played.map((r) => r.msToPlay || 0).sort((a, b) => a - b)
const mean = msArr.length ? msArr.reduce((a, b) => a + b, 0) / msArr.length : 0
const p50 = msArr[Math.floor(msArr.length * 0.5)] || 0
const p90 = msArr[Math.floor(msArr.length * 0.9)] || 0

console.log(`\n══ FAILOVER SUMMARY — ${rows.length} titles · ${((Date.now() - startedAt) / 60000).toFixed(1)} min ══`)
console.log(`  resolved a slug                       ${resolved.length}/${rows.length}`)
console.log(`  EPISODE PLAYED                        ${played.length}/${resolved.length}  (${pct(played.length, resolved.length)}% of resolvable titles)`)
console.log(`    · served on the requested track     ${played.length - crossOnly.length}`)
console.log(`    · saved by the cross-track fallback ${crossOnly.length}`)
console.log(`  time to first play                    mean ${(mean / 1000).toFixed(2)}s · p50 ${(p50 / 1000).toFixed(2)}s · p90 ${(p90 / 1000).toFixed(2)}s`)
const chip1 = played.filter((r) => (r.chipIndexInChain || 99) === 1).length
const chip1to3 = played.filter((r) => (r.chipIndexInChain || 99) <= 3).length
console.log(`  served by chain position              #1 ${chip1} · #1-3 ${chip1to3} · deeper ${played.length - chip1to3}`)
console.log(`  NEVER PLAYED (no upstream stream)     ${trulyStuck.length}`)
for (const r of trulyStuck.slice(0, 15)) {
  console.log(`    ✗ ${r.title.slice(0, 46).padEnd(48)} ${r.dubListed} dub / ${r.subListed} sub listed · ${r.chipsTried} chips tried`)
}
fs.writeFileSync(OUT_JSON, JSON.stringify({ partial: false, rows, summary: {
  titles: rows.length, resolved: resolved.length, played: played.length,
  crossTrackSaved: crossOnly.length, neverPlayed: trulyStuck.length,
  msToPlay: { mean, p50, p90 },
} }, null, 2))
console.log(`\n  full results → ${OUT_JSON}`)
console.log('failover bench done')
