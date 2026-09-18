// Server-stream benchmark on 20 OBSCURE (non-popular) anime.
//
// For every title it walks the exact path the Watch page walks:
//   1. GET /api/anidap/info/:anilistId              → slug   (cold)
//   2. GET /api/anidap/servers/:slug/1?anilistId=…  → provider list + _healthy
//   3. GET /api/anidap/sources/:slug/1/:provider/sub?anilistId=…&malId=…  → stream
//      (this is the one that decides whether a server is really usable for
//       THIS title — the picker's problem was servers listed for everything
//       but 404ing on obscure shows)
//
// Prints a per-title table plus a per-server scoreboard (ok / fail / avg ms),
// and which servers returned subtitles.
//
// Usage: node scripts-perf/servers_bench.mjs [origin] [count] [--all-servers]
const ORIGIN = process.argv[2] || 'http://localhost:5173'
const COUNT = Number((process.argv[3] || '20').replace(/^--.*/, '')) || 20
const ALL_SERVERS = process.argv.includes('--all-servers')
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

// ── 1. Pick 20 obscure-but-real titles (low popularity, ratings floor) ──
// POPULARITY_ASC on AniList returns the least-followed entries; the floors
// keep them real shows with a MAL id (everything in this app keys off idMal),
// so we measure the long tail instead of the top 100 the caches already hold.
const PICK_Q = `query ($perPage: Int) {
  Page(page: 1, perPage: $perPage) {
    media(type: ANIME, sort: POPULARITY, isAdult: false,
          averageScore_greater: 62, episodes_greater: 4,
          format_in: [TV, TV_SHORT, ONA, OVA]) {
      id idMal popularity averageScore episodes format
      title { english romaji }
    }
  }
}`

// Route the pick through the app's own AniList relay: it shares the server's
// rate-limit budget (server/lib/anilist-budget.js) so the bench never trips a
// 429 for the app while it runs, and it works when the host blocks direct
// graphql.anilist.co calls.
const pick = await fetch(`${ORIGIN}/api/anilist-gql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: PICK_Q, variables: { perPage: 60 } }),
}).then((r) => r.json()).catch(() => null)

const candidates = (pick?.data?.Page?.media || []).filter((m) => m.idMal)
if (candidates.length === 0) {
  console.log('Could not fetch the obscure-title list from AniList — aborting.')
  process.exit(1)
}
// Deterministic sample across the pool (not just the lowest 20).
const step = Math.max(1, Math.floor(candidates.length / COUNT))
const picks = []
for (let i = 0; i < candidates.length && picks.length < COUNT; i += step) picks.push(candidates[i])

console.log(`═ SERVER STREAM BENCH — ${picks.length} obscure titles ═`)
console.log(`origin ${ORIGIN} · source timeout ${SOURCE_TIMEOUT_MS / 1000}s${ALL_SERVERS ? ' · ALL servers per title' : ' · first 6 servers per title'}`)
console.log('\nTitles (AniList popularity / score):')
for (const m of picks) {
  console.log(`  · ${String(m.title.english || m.title.romaji).slice(0, 52).padEnd(54)} pop ${String(m.popularity).padStart(6)}  score ${String(m.averageScore).padStart(3)}  ${m.format} ${m.episodes ?? '?'}ep  mal ${m.idMal}`)
}

// ── 2. Per-server scoreboard ──
const board = new Map()
function note(name, ok, ms, subs) {
  const b = board.get(name) || { ok: 0, fail: 0, msSum: 0, msN: 0, subs: 0, errors: new Map() }
  if (ok) b.ok++
  else b.fail++
  if (ms > 0) { b.msSum += ms; b.msN++ }
  if (subs > 0) b.subs++
  board.set(name, b)
}
function noteError(name, message) {
  const b = board.get(name) || { ok: 0, fail: 0, msSum: 0, msN: 0, subs: 0, errors: new Map() }
  const key = String(message || '').slice(0, 60)
  b.errors.set(key, (b.errors.get(key) || 0) + 1)
  board.set(name, b)
}

const rows = []
for (const [i, m] of picks.entries()) {
  const title = m.title.english || m.title.romaji
  const label = `[${String(i + 1).padStart(2)}/${picks.length}] ${title.slice(0, 44)}`
  const info = await json(`/api/anidap/info/${m.id}`)
  const slug = info.body?.data?.slug || info.body?.slug || null
  if (!slug) {
    console.log(`${label.padEnd(50)} info ${info.status} in ${(info.ms / 1000).toFixed(2)}s — NO SLUG`)
    rows.push({ title, info: info.ms, slug: null })
    continue
  }

  const servers = await json(`/api/anidap/servers/${encodeURIComponent(slug)}/1?anilistId=${m.id}`)
  const providers = servers.body?.data?.providers || []
  const usable = providers.filter((p) => p._healthy !== false)
  const list = ALL_SERVERS ? usable : usable.slice(0, 6)
  console.log(`${label.padEnd(50)} slug ${(info.ms / 1000).toFixed(2)}s · servers ${(servers.ms / 1000).toFixed(2)}s · ${providers.length} listed / ${usable.length} healthy`)

  const results = []
  for (const p of list) {
    const type = p.type || 'sub'
    const url = `/api/anidap/sources/${encodeURIComponent(slug)}/1/${encodeURIComponent(p.name)}/${type}?anilistId=${m.id}&malId=${m.idMal}`
    const s = await json(url, SOURCE_TIMEOUT_MS)
    const d = s.body?.data
    const streamUrl = d?.url || d?.raw || null
    const subs = Array.isArray(d?.subtitles) ? d.subtitles.length : Array.isArray(d?.tracks) ? d.tracks.length : 0
    const ok = s.status === 200 && !!streamUrl
    note(p.name, ok, s.ms, subs)
    if (!ok) noteError(p.name, s.body?.message || s.body?.error || `HTTP ${s.status}`)
    results.push({ name: p.name, type, ok, ms: s.ms, subs, why: s.body?.message || s.body?.error || `HTTP ${s.status}` })
    console.log(`     ${ok ? '✓' : '✗'} ${String(p.name).padEnd(12)} ${String(type).padEnd(4)} ${(s.ms / 1000).toFixed(2).padStart(6)}s  ${ok ? `${subs} subs` : String(results.at(-1).why).slice(0, 48)}`)
  }
  rows.push({ title, info: info.ms, slug: true, servers: servers.ms, listed: providers.length, healthy: usable.length, results })
  await sleep(250)
}

// ── 3. Scoreboard ──
console.log('\n══ PER-SERVER SCOREBOARD (stream resolution for this title set) ══')
const sorted = [...board.entries()].sort((a, b) => b[1].ok / (b[1].ok + b[1].fail) - a[1].ok / (a[1].ok + a[1].fail))
for (const [name, b] of sorted) {
  const total = b.ok + b.fail
  const rate = total ? Math.round((b.ok / total) * 100) : 0
  const avg = b.msN ? (b.msSum / b.msN / 1000).toFixed(2) : '-'
  const top = [...b.errors.entries()].sort((x, y) => y[1] - x[1])[0]
  console.log(`  ${String(name).padEnd(14)} ${String(rate + '%').padStart(4)}  ok ${String(b.ok).padStart(2)} / fail ${String(b.fail).padStart(2)}  avg ${String(avg).padStart(5)}s  subs ${b.subs}${top ? `  · mostly: ${top[0].slice(0, 44)}` : ''}`)
}

const withStream = rows.filter((r) => r.results?.some((x) => x.ok)).length
const noSlug = rows.filter((r) => !r.slug).length
const noStream = rows.filter((r) => r.results && !r.results.some((x) => x.ok)).length
console.log(`\nSUMMARY: ${withStream}/${rows.length} titles got a working stream · ${noStream} had a server list but no working stream · ${noSlug} never resolved a slug`)
console.log('bench done')
