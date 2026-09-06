// Verify the proxy-first grid: on /browse every card image should be an
// /img (localhost) URL, all should decode, and we time how long the /img
// fetches took (resource timing) + confirm the server disk cache fills.
import puppeteer from 'puppeteer'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await b.pages()
const page = pages.find((p) => p.url().includes('localhost:5173')) || pages[0]

const t0 = Date.now()
await page.goto('http://localhost:5173/browse', { waitUntil: 'domcontentloaded', timeout: 45000 })

// wait for images to settle (up to 25s — Jikan may be slow)
let stats = null
for (let i = 0; i < 50; i++) {
  stats = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')]
    const cardImgs = imgs.filter((x) => x.closest('a[href*="/anime/"]'))
    const done = cardImgs.filter((x) => x.complete && x.naturalWidth > 1).length
    const proxied = cardImgs.filter((x) => x.currentSrc.includes('/img?url=') || x.src.includes('/img?url=')).length
    const broken = cardImgs.filter((x) => x.complete && x.naturalWidth === 0).length
    return { total: cardImgs.length, done, proxied, broken }
  })
  if (stats && stats.total > 10 && stats.done === stats.total) break
  await sleep(500)
}
log('grid after', ((Date.now() - t0) / 1000).toFixed(1) + 's:', JSON.stringify(stats))

// Resource timing for /img fetches (proxy = localhost server responses)
const timing = await page.evaluate(() => {
  const es = performance.getEntriesByType('resource').filter((e) => e.name.includes('/img?url='))
  if (!es.length) return null
  const durs = es.map((e) => e.duration).sort((a, b) => a - b)
  const avg = durs.reduce((p, q) => p + q, 0) / durs.length
  return { n: es.length, avgMs: Math.round(avg), p50: Math.round(durs[Math.floor(durs.length / 2)]), p95: Math.round(durs[Math.floor(durs.length * 0.95)]), max: Math.round(durs[durs.length - 1]) }
})
log('/img resource timing:', JSON.stringify(timing))

await page.screenshot({ path: path.join(OUT, 'grid-proxy-first.png') }).catch(() => {})
log('screenshot saved')

// Disk cache check
try {
  const dir = path.join(os.tmpdir(), 'kurodo-img')
  if (fs.existsSync(dir)) {
    const bins = fs.readdirSync(dir).filter((f) => f.endsWith('.bin')).length
    log('disk cache files in', dir, ':', bins)
  } else log('disk cache dir missing')
} catch (e) { log('disk check err', e.message) }

await b.disconnect()
process.exit(0)
