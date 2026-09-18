// Measures REAL user-perceived latency for the reported-slow surfaces:
//   • /browse  (Top Rated / Popular / This Season / Upcoming / A–Z letter B)
//   • /schedule
// Also dumps every /api/jikan + /api/anilist-gql resource timing so we can
// see whether the delay is one slow request or client-side queueing.
// Usage: node scripts-perf/browse_timing_probe.mjs [origin] [label]
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const LABEL = process.argv[3] || 'before'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

async function open(url) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.evaluateOnNewDocument(() => {
    // Skip the welcome wizard so it never covers content/cards.
    try { localStorage.setItem('kurodo-setup-done', '1') } catch { /* ignore */ }
  })
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  return p
}

/** Wait until the page shows real cards (or a definitive error/empty state). */
async function waitForCards(p, budgetMs = 45000) {
  const t0 = Date.now()
  for (;;) {
    const st = await p.evaluate(() => {
      const cards = document.querySelectorAll('a[href^="/anime/"]').length
      const busy = !!document.querySelector('.animate-pulse, .shimmer')
      const body = document.body.innerText || ''
      const err = /Couldn'?t load|unreachable|No results|Unable to load/i.test(body)
      return { cards, busy, err }
    })
    if (st.cards > 0) return { ms: Date.now() - t0, cards: st.cards, state: 'cards' }
    if (!st.busy && st.err) return { ms: Date.now() - t0, cards: 0, state: 'error' }
    if (Date.now() - t0 > budgetMs) return { ms: Date.now() - t0, cards: st.cards, state: 'timeout' }
    await sleep(150)
  }
}

/** Dump resource timings for API calls since navigation start. */
async function apiTimings(p) {
  return p.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => /\/api\/(jikan|anilist-gql|kitsu)/.test(e.name))
      .map((e) => ({
        url: e.name.replace(location.origin, '').slice(0, 96),
        ms: Math.round((e.responseEnd || e.duration) - (e.startTime || 0)),
        start: Math.round(e.startTime),
      }))
      .sort((a, b2) => a.start - b2.start),
  )
}

async function probe(p, label, url, shot) {
  const p2 = await open(url)
  const nav = Date.now()
  const r = await waitForCards(p2)
  const api = await apiTimings(p2)
  console.log(`\n── ${label} ──`)
  console.log(`   wall: ${((Date.now() - nav) / 1000).toFixed(2)}s   cards: ${r.cards}   state: ${r.state}`)
  for (const a of api) {
    console.log(`     +${String(a.start).padStart(6)}ms  ${String(a.ms).padStart(6)}ms  ${a.url}`)
  }
  if (shot) {
    await p2.screenshot({ path: path.join(OUT, `perf-${LABEL}-${shot}.png`) })
    console.log(`   shot: perf-${LABEL}-${shot}.png`)
  }
  await p2.close()
  return r
}

console.log('═ BROWSE / SCHEDULE USER-FELT TIMING ═', BASE, `(${LABEL})`)

// Warm the app shell first (Home) so we measure page data, not JS parse.
{
  const p = await open(`${BASE}/`)
  await waitForCards(p, 30000)
  await p.close()
}

const cases = [
  ['browse top-rated', `${BASE}/browse?filter=top-rated`, 'browse-top'],
  ['browse popular', `${BASE}/browse?filter=popular`, 'browse-popular'],
  ['browse this-season', `${BASE}/browse?filter=seasonal`, 'browse-seasonal'],
  ['browse upcoming', `${BASE}/browse?filter=upcoming`, 'browse-upcoming'],
  ['browse A–Z letter B', `${BASE}/browse?filter=az&letter=B`, 'browse-az-b'],
  ['schedule', `${BASE}/schedule`, 'schedule'],
]

for (const [label, url, shot] of cases) {
  await probe(null, label, url, shot)
}

// Second pass — now everything is warm; shows the cached experience.
console.log('\n══ WARM SECOND PASS ══')
for (const [label, url] of cases) {
  await probe(null, label + ' (warm)', url, null)
}

await b.close()
console.log('\nprobe done')
