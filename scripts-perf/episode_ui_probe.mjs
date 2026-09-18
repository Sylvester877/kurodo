// Measures the user-felt episode-list load: time until the first episode
// tile is on screen, how many DOM nodes the list creates, and the transferred
// sizes of the episode API calls. Reports per anime so a 1100-episode show can
// be compared with a 28-episode one.
// Usage: node scripts-perf/episode_ui_probe.mjs [origin] [label]
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const LABEL = process.argv[3] || 'now'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

const CASES = [
  ['details-one-piece', `${BASE}/anime/21`, 'One Piece'],
  ['details-frieren', `${BASE}/anime/52991`, 'Frieren'],
  ['watch-one-piece', `${BASE}/watch/21?ep=1`, 'One Piece'],
  ['watch-frieren', `${BASE}/watch/52991?ep=1`, 'Frieren'],
]

for (const [label, url, name] of CASES) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  await p.evaluateOnNewDocument(() => {
    try { localStorage.setItem('kurodo-setup-done', '1') } catch { /* ignore */ }
  })
  const api = []
  p.on('response', async (r) => {
    const u = r.url()
    if (/anikage-episodes|anizip\/mapping|episode-thumbs/.test(u)) {
      const len = Number(r.headers()['content-length'] || 0)
      api.push({ url: u.replace(BASE, ''), status: r.status(), kb: Math.round(len / 1024) })
    }
  })

  const t0 = Date.now()
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // Episode rows are <button>s (Watch sidebar, virtualized) or links
  // (Details "first 12" grid). Count both, plus the tallest list on screen.
  const COUNT = `Array.from(document.querySelectorAll('button, a')).filter(el => /^EP\\s*\\d+/i.test((el.innerText || '').trim()) || /\\bEP\\s*\\d+\\b/i.test((el.innerText || '').slice(0, 40))).length`
  let firstTiles = null
  let peak = 0
  for (;;) {
    const n = await p.evaluate(COUNT)
    if (n > peak) peak = n
    if (n > 0 && firstTiles == null) firstTiles = Date.now() - t0
    if (n > 0) break
    if (Date.now() - t0 > 45000) break
    await sleep(150)
  }
  // Let the list settle and the images arrive; track the highest row count.
  const settleT = Date.now()
  while (Date.now() - settleT < 5000) {
    const n = await p.evaluate(COUNT)
    if (n > peak) peak = n
    await sleep(250)
  }
  const info = await p.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('button, a')).filter(el => /^EP\\s*\\d+/i.test((el.innerText || '').trim()) || /\\bEP\\s*\\d+\\b/i.test((el.innerText || '').slice(0, 40)))
    const imgs = rows.map(t => t.querySelector('img')).filter(Boolean)
    const api = performance.getEntriesByType('resource')
      .filter(e => /anikage-episodes|anizip\\/mapping|episode-thumbs/.test(e.name))
      .map(e => ({ url: e.name.replace(location.origin, ''), kb: Math.round((e.decodedBodySize || 0) / 1024), ms: Math.round(e.duration) }))
    return {
      tiles: rows.length,
      withImg: imgs.filter(i => i.getAttribute('src')).length,
      broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      domNodes: document.querySelectorAll('*').length,
      api,
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 90),
    }
  })()`)

  console.log(`\n── ${label} ── ${name}`)
  console.log(`   first rows ${firstTiles ? (firstTiles / 1000).toFixed(2) + 's' : 'never'}   peak rows ${peak}   rows ${info.tiles}   withImg ${info.withImg}   broken ${info.broken}   DOM ${info.domNodes}`)
  console.log(`   page: ${info.text}`)
  const seen = new Set()
  for (const a of [...info.api, ...api]) {
    if (seen.has(a.url)) continue
    seen.add(a.url)
    console.log(`     ${String(a.kb).padStart(6)}KB ${String(a.ms).padStart(6)}ms  ${a.url}`)
  }
  await p.screenshot({ path: path.join(OUT, `perf-${LABEL}-${label}.png`) })
  await p.close()
}

await b.close()
console.log('\nprobe done')
