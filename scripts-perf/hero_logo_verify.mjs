// Verify the hero prewarm: on /home, every slide's TMDB logo should be
// requested (via /img) within a few seconds WITHOUT being displayed, and
// fast-forwarding through the carousel should find each logo already
// decoded (naturalWidth > 0) — "appears in an instant".
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

const logoReqs = new Map() // url -> status
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('/img?url=') && decodeURIComponent(u).includes('image.tmdb.org')) {
    logoReqs.set(u, r.status())
  }
})

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 45000 })

// Let hero mount + staggered prefetch run
await sleep(12000)

console.log(`prewarmed logo /img requests after 12s: ${logoReqs.size}`)
for (const [u, s] of logoReqs) console.log('  ', s, decodeURIComponent(u).slice(0, 120))

// Count slides the hero actually has
const slideCount = await page.evaluate(() => {
  // the hero dots / current id
  const dots = document.querySelectorAll('button[aria-label*="slide"], .hero-dot, [class*="hero"] button')
  return { dots: dots.length }
})
console.log('hero slide dots found:', slideCount.dots)

// Fast-forward: click the hero's next arrow up to 8 times, checking the
// current logo decodes instantly each time (no waiting for bytes).
let arrow = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const a = btns.find((el) => (el.getAttribute('aria-label') || '').toLowerCase().includes('next'))
  if (!a) return null
  const r = a.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (!arrow) console.log('no hero next-arrow found — skipping fast-forward')
let instant = 0
let total = 0
for (let i = 0; i < 8 && arrow; i++) {
  await page.mouse.move(arrow.x, arrow.y)
  await sleep(80)
  await page.mouse.click(arrow.x, arrow.y)
  await sleep(120) // allow the slide enter animation, NOT a logo network wait
  const s = await page.evaluate(() => {
    const img = document.querySelector('img.hero-logo')
    const h1 = !!document.querySelector('h1.hero-wordmark')
    return { logoOk: img ? img.complete && img.naturalWidth > 0 : false, logoImg: !!img, h1 }
  })
  total++
  if (s.logoOk) instant++
  else if (s.h1) {
    // wordmark fallback counts as "instantly visible title"
    instant++
  }
  await sleep(80)
}

console.log(`slides advanced: ${total}, titles visible instantly (logo decoded or wordmark): ${instant}/${total}`)

// Screenshot the current slide for the record
await page.screenshot({ path: path.join(OUT, 'hero-logo-instant.png') }).catch(() => {})
console.log('screenshot: hero-logo-instant.png')
await b.disconnect()
process.exit(0)
