// Post-change smoke: home / browse / details / watch still render real content,
// no console errors, and report how long each surface took to show data.
// Usage: node scripts-perf/fetch_smoke.mjs [origin] [label]
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const LABEL = process.argv[3] || 'smoke'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

async function visit(url, label, readyExpr, waitMs = 30000) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  await p.evaluateOnNewDocument(() => {
    try { localStorage.setItem('kurodo-setup-done', '1') } catch { /* ignore */ }
  })
  const errors = []
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)) })
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 140)))

  const t0 = Date.now()
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  let first = null
  for (;;) {
    const ok = await p.evaluate(readyExpr)
    if (ok && first == null) first = Date.now() - t0
    if (ok) break
    if (Date.now() - t0 > waitMs) break
    await sleep(200)
  }
  await sleep(900)
  const info = await p.evaluate(() => ({
    cards: document.querySelectorAll('a[href^="/anime/"]').length,
    imgs: document.querySelectorAll('img').length,
    brokenImgs: Array.from(document.querySelectorAll('img')).filter((i) => i.complete && i.naturalWidth === 0).length,
    text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
  }))
  console.log(`  ${label.padEnd(18)} first-data ${first ? (first / 1000).toFixed(2) + 's' : 'none'}  cards ${info.cards}  imgs ${info.imgs} (broken ${info.brokenImgs})`)
  if (errors.length) console.log(`     console errors: ${errors.slice(0, 3).join(' | ')}`)
  await p.screenshot({ path: path.join(OUT, `perf-${LABEL}-${label}.png`) })
  await p.close()
}

console.log(`═ FETCH SMOKE (${LABEL}) ═`, BASE)
await visit(`${BASE}/`, 'home', 'document.querySelectorAll(\'a[href^="/anime/"]\').length > 3')
await visit(`${BASE}/browse?filter=popular`, 'browse-popular', 'document.querySelectorAll(\'a[href^="/anime/"]\').length > 3')
await visit(`${BASE}/browse?filter=seasonal`, 'browse-seasonal', 'document.querySelectorAll(\'a[href^="/anime/"]\').length > 3')
await visit(`${BASE}/browse?filter=az&letter=S`, 'browse-az-S', 'document.querySelectorAll(\'a[href^="/anime/"]\').length > 3')
await visit(`${BASE}/schedule`, 'schedule', 'document.querySelectorAll(\'a[href^="/anime/"]\').length > 3')
await visit(`${BASE}/anime/21`, 'details', 'document.body.innerText.includes("One Piece") || document.querySelectorAll(\'a[href^="/watch/"]\').length > 0')
await visit(`${BASE}/watch/21?ep=1`, 'watch', '!!document.querySelector("video")', 45000)
await b.close()
console.log('smoke done')
