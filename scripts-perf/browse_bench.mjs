// Focused benchmark for the "slow" surfaces: browse filters (popular, top,
// season, upcoming, A–Z, genre) + the schedule chain. Run twice so the
// second pass shows warm-cache numbers.
// Usage: node scripts-perf/browse_bench.mjs [origin]
const ORIGIN = process.argv[2] || 'http://localhost:5173'

async function t(label, url, opts = {}) {
  const s = Date.now()
  let status = 'ERR'
  let note = ''
  try {
    const r = await fetch(ORIGIN + url, { signal: AbortSignal.timeout(40000), ...opts })
    status = r.status
    const txt = await r.text()
    try {
      const j = JSON.parse(txt)
      const arr = j?.data
      note = Array.isArray(arr) ? `${arr.length} items` : j?.errors?.[0]?.message ? String(j.errors[0].message).slice(0, 30) : ''
    } catch { note = `${txt.length}b` }
  } catch (e) { status = 'ERR:' + e.name }
  return { label, status, ms: Date.now() - s, note }
}

const CASES = [
  ['browse:popular', '/api/jikan/top/anime?filter=bypopularity&limit=24'],
  ['browse:top-rated', '/api/jikan/top/anime?limit=24'],
  ['browse:season-now', '/api/jikan/seasons/now?limit=24'],
  ['browse:upcoming', '/api/jikan/seasons/upcoming?limit=24'],
  ['browse:az-B', '/api/jikan/anime?letter=B&limit=24&order_by=title&sort=asc'],
  ['browse:genre-action', '/api/jikan/anime?genres=1&limit=24&order_by=score&sort=desc'],
  ['search:naruto', '/api/jikan/anime?q=naruto&limit=24&sfw=true'],
]

const SCHEDULE_Q = 'query($f:Int,$t:Int,$p:Int){Page(page:$p,perPage:50){pageInfo{hasNextPage} airingSchedules(airingAt_greater:$f,airingAt_lesser:$t,sort:TIME){id airingAt episode media{id idMal title{romaji english} coverImage{large} averageScore genres format}}}}'

function scheduleBody(page) {
  const now = new Date()
  const from = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000)
  return JSON.stringify({ query: SCHEDULE_Q, variables: { f: from, t: from + 7 * 86400, p: page } })
}

console.log('═ BROWSE / SCHEDULE BENCH ═', ORIGIN)
for (const pass of ['COLD', 'WARM']) {
  console.log(`\n── ${pass} pass ──`)
  for (const [label, url] of CASES) {
    const r = await t(label, url)
    console.log(`  ${label.padEnd(22)} ${String(r.status).padEnd(6)} ${(r.ms / 1000).toFixed(2).padStart(6)}s  ${r.note}`)
  }
  for (const p of [1, 2, 3]) {
    const r = await t(`schedule:p${p}`, '/api/anilist-gql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: scheduleBody(p),
    })
    console.log(`  ${('schedule page' + p).padEnd(22)} ${String(r.status).padEnd(6)} ${(r.ms / 1000).toFixed(2).padStart(6)}s  ${r.note}`)
  }
}
console.log('\nbench done')
