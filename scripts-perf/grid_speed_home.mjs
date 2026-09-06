// Verify proxy-first everywhere that works without Jikan: Home rails
// (AniList) + the AnimeDetails hero banner.
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await b.pages()
const page = pages.find((p) => p.url().includes('localhost:5173')) || pages[0]

// ── HOME ──
const t0 = Date.now()
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(3500)
for (let y = 0; y < 2600; y += 500) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y)
  await sleep(200)
}
let home = null
for (let i = 0; i < 30; i++) {
  home = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter((x) => x.src && x.src.startsWith('http'))
    const done = imgs.filter((x) => x.complete && x.naturalWidth > 1).length
    const proxied = imgs.filter((x) => x.currentSrc.includes('/img?url=')).length
    const broken = imgs.filter((x) => x.complete && x.naturalWidth === 0).length
    return { total: imgs.length, done, proxied, broken }
  })
  if (home.total > 10 && home.done === home.total) break
  await sleep(400)
}
const homeTiming = await page.evaluate(() => {
  const es = performance.getEntriesByType('resource').filter((e) => e.name.includes('/img?url='))
  if (!es.length) return null
  const durs = es.map((e) => e.duration).sort((a, b) => a - b)
  return { n: es.length, avgMs: Math.round(durs.reduce((p, q) => p + q, 0) / durs.length), p50: Math.round(durs[Math.floor(durs.length / 2)]), max: Math.round(durs[durs.length - 1]) }
})
const homeExt = await page.evaluate(() =>
  performance.getEntriesByType('resource').filter((e) => /s4\.anilist\.co|cdn\.myanimelist|image\.tmdb\.org/.test(e.name)).length,
)
log('HOME after', ((Date.now() - t0) / 1000).toFixed(1) + 's:', JSON.stringify(home), '/img:', JSON.stringify(homeTiming), 'directCDN:', homeExt)
await page.screenshot({ path: path.join(OUT, 'home-proxy-first.png') }).catch(() => {})

// ── DETAILS BANNER (FMA:B) ──
await page.goto('http://localhost:5173/anime/5114', { waitUntil: 'domcontentloaded', timeout: 45000 })
let banner = null
for (let i = 0; i < 30; i++) {
  banner = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')]
    const hero = imgs.find((x) => x.width === 1920 || (x.getBoundingClientRect().width > 900))
    return {
      heroSrc: hero ? (hero.currentSrc || hero.src).slice(0, 140) : 'none',
      heroOk: hero ? hero.complete && hero.naturalWidth > 1 : false,
      totalImgs: imgs.length,
      doneImgs: imgs.filter((x) => x.complete && x.naturalWidth > 1).length,
    }
  })
  if (banner && banner.heroOk) break
  await sleep(500)
}
log('DETAILS banner:', JSON.stringify(banner))
await page.screenshot({ path: path.join(OUT, 'details-banner-proxy.png') }).catch(() => {})
await b.disconnect()
process.exit(0)
