// Measure TMDB logo speed: cold (first ever visit to an anime) vs warm
// (navigate away + back). Times how long after navigation until the
// details-page logo <img> has decoded pixels (naturalWidth > 0).
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })
const pages = await b.pages()
const page = pages.find((p) => p.url().includes('localhost:5173')) || pages[0]

const NET = []
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('/img?') || u.includes('image.tmdb.org') || u.includes('api.themoviedb.org')) {
    NET.push({ u: u.slice(0, 110), status: r.status(), t: Date.now() })
  }
})

async function measure(title, malId) {
  const start = Date.now()
  await page.goto(`http://localhost:5173/anime/${malId}?t=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  })
  // Wait for either a logo img with pixels OR the h1 fallback to settle
  let logoMs = -1
  let sawH1 = false
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate(() => {
      const img = document.querySelector('img.details-logo, img.hero-logo, img.watch-logo')
      const h1 = !!document.querySelector('h1')
      const logoOk = img ? img.complete && img.naturalWidth > 0 : false
      const logoPending = img ? !logoOk : false
      return { logoOk, logoPending, h1 }
    }).catch(() => null)
    if (s?.logoOk) { logoMs = Date.now() - start; break }
    if (s?.h1) sawH1 = true
    if (i > 45 && sawH1 && s && !s.logoPending) break // settled on wordmark
    await sleep(250)
  }
  const urlNow = page.url()
  await page.screenshot({ path: path.join(OUT, `logo-${title}.png`) }).catch(() => {})
  return { title, logoMs: logoMs === -1 ? 'n/a (h1 fallback)' : logoMs, urlNow }
}

console.log('COLD (never visited this session):')
const cold = await measure('cold-bleach', 41467)
console.log(' ', cold)

console.log('WARM (navigate away + straight back):')
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(1200)
const warm = await measure('warm-bleach', 41467)
console.log(' ', warm)

console.log('--- logo-related network (last 10) ---')
for (const n of NET.slice(-10)) console.log(' ', n.status, n.t % 100000, n.u)
await b.disconnect()
process.exit(0)
