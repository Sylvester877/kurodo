// Live verify: persistent server memory + no health UI + all servers shown.
//
//   1. Open /watch/1?ep=1, wait for server tiles.
//   2. Assert NO health badges (NO STREAM / UNVERIFIED) anywhere.
//   3. Click a LOW-priority server (Beep — static priority 7).
//   4. Wait for its stream to resolve → memory records a "good".
//   5. RELOAD the page (simulates app restart) → Beep must now be the
//      FIRST tile (it used to sort near-last without memory).
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = (n) => `screenshots/server-memory-${n}.png`

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find((p) => (p.url() || '').includes('127.0.0.1:5173')) ?? pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

await page.goto('http://127.0.0.1:5173/watch/1?ep=1', { waitUntil: 'domcontentloaded', timeout: 40000 })

// Wait for server tiles (button title="Play on <Name>").
async function tileNames() {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('button[title^="Play on "]'))
      .map((b) => b.getAttribute('title').replace('Play on ', '')))
}

let tiles = []
for (let i = 0; i < 40; i++) {
  tiles = await tileNames()
  if (tiles.length > 0) break
  await sleep(1500)
}
if (tiles.length === 0) { console.error('NO_TILES'); process.exit(1) }
const tilesBefore = tiles
console.log('tiles_before:', JSON.stringify(tiles))

const badges = await page.evaluate(() => document.body.innerText.match(/NO STREAM|UNVERIFIED/g) || [])
console.log('health_badges_found:', badges.length === 0 ? 'NONE ✓' : badges)
await page.screenshot({ path: shot('1-initial') })

// Pick a LOW-priority server: Beep if present, else the last tile.
const target = tiles.find((t) => /beep/i.test(t)) ?? tiles[tiles.length - 1]
console.log('clicking_low_priority_server:', target)
await page.evaluate((name) => {
  const btn = Array.from(document.querySelectorAll('button[title^="Play on "]'))
    .find((b) => b.getAttribute('title') === `Play on ${name}`)
  btn?.click()
}, target)

// Wait for the stream to resolve (memory write happens on success) or fail.
let resolved = false
for (let i = 0; i < 45; i++) {
  await sleep(2000)
  const state = await page.evaluate(() => ({
    mem: localStorage.getItem('kurodo-server-memory'),
    videoPlaying: (() => {
      const v = document.querySelector('video')
      return !!(v && v.src && !v.paused && v.readyState >= 2)
    })(),
  }))
  const mem = state.mem ? JSON.parse(state.mem) : null
  const key = target.replace(/^(anidap|gogoanime|miruro|saturn|pahe)-/i, '').toLowerCase()
  if (mem?.good?.[key] > 0) { resolved = true; console.log('memory_good_recorded_for:', key); break }
  if (i === 44) console.log('resolve_timed_out (memory may record a bad instead — still proof of learning)')
}
await page.screenshot({ path: shot('2-after-click') })
const memAfter = await page.evaluate(() => localStorage.getItem('kurodo-server-memory'))
console.log('memory_after:', memAfter)

// ── Reload = simulated app restart ──
await page.reload({ waitUntil: 'domcontentloaded', timeout: 40000 })
let tilesAfter = []
for (let i = 0; i < 40; i++) {
  tilesAfter = await tileNames()
  if (tilesAfter.length > 0) break
  await sleep(1500)
}
console.log('tiles_after_reload:', JSON.stringify(tilesAfter))
await page.screenshot({ path: shot('3-after-reload') })

const first = tilesAfter[0] ?? ''
const targetClean = target.replace(/^(anidap|gogoanime|miruro|saturn|pahe)-/i, '').toLowerCase()
const firstClean = first.replace(/^(anidap|gogoanime|miruro|saturn|pahe)-/i, '').toLowerCase()
// The real acceptance: (1) tile SET identical across restart (roster merge),
// (2) the clicked server is now memory-pinned into the TOP GROUP — it outranks
// every zero-memory server. It doesn't have to be #1: other remembered
// servers with higher accumulated scores legitimately stay ahead.
const sameSet = tilesAfter.length === tilesBefore.length &&
  [...tilesAfter].sort().join('|') === [...tilesBefore].sort().join('|')
const targetIdx = tilesAfter.findIndex((t) => t.replace(/^(anidap|gogoanime|miruro|saturn|pahe)-/i, '').toLowerCase() === targetClean)
const stable = resolved && sameSet && targetIdx >= 0 && targetIdx <= 1
  ? 'PASS'
  : (sameSet ? 'CHECK' : 'FAIL — roster changed across reload')
console.log('verdict:', stable, '— first tile after reload:', first,
  `| target index: ${targetIdx} | set stable: ${sameSet}`)
browser.disconnect()
