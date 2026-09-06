// Verify proxy-first grids end-to-end on /browse with scrolling.
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
await sleep(4000)

// Scroll through the page to trigger lazy images
for (let y = 0; y < 2200; y += 450) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y)
  await sleep(250)
}

// Wait for imgs to settle
let stats = null
for (let i = 0; i < 40; i++) {
  stats = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter((x) => x.src && x.src.startsWith('http'))
    const done = imgs.filter((x) => x.complete && x.naturalWidth > 1).length
    const proxied = imgs.filter((x) => x.currentSrc.includes('/img?url=')).length
    const broken = imgs.filter((x) => x.complete && x.naturalWidth === 0).length
    return { total: imgs.length, done, proxied, broken }
  })
  if (stats.done === stats.total && stats.total > 5) break
  await sleep(500)
}
log('after', ((Date.now() - t0) / 1000).toFixed(1) + 's:', JSON.stringify(stats))

const timing = await page.evaluate(() => {
  const es = performance.getEntriesByType('resource').filter((e) => e.name.includes('/img?url='))
  if (!es.length) return null
  const durs = es.map((e) => e.duration).sort((a, b) => a - b)
  const avg = durs.reduce((p, q) => p + q, 0) / durs.length
  return { n: es.length, avgMs: Math.round(avg), p50: Math.round(durs[Math.floor(durs.length / 2)]), p95: Math.round(durs[Math.floor(durs.length * 0.95)]), max: Math.round(durs[durs.length - 1]) }
})
log('/img resource timing:', JSON.stringify(timing))

// external CDN requests still happening? (should be ~0 now)
const external = await page.evaluate(() =>
  performance.getEntriesByType('resource')
    .filter((e) => /s4\.anilist\.co|cdn\.myanimelist|image\.tmdb\.org/.test(e.name))
    .length,
)
log('direct CDN requests on this page load:', external)

await page.screenshot({ path: path.join(OUT, 'grid-proxy-first2.png') }).catch(() => {})
log('screenshot saved')
await b.disconnect()
process.exit(0)
