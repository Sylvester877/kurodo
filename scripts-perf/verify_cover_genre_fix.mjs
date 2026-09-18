// Verify: (1) manga search covers actually load via /img proxy, (2) Browse
// genre page renders cards. Screenshots for both.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 1. Manga tab covers ──────────────────────────────────────
await p.goto('http://localhost:5173/search?q=one%20piece', { waitUntil: 'domcontentloaded' })
await sleep(6_000)
await p.evaluate(() => { [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Manga')?.click() })
await sleep(15_000)
const manga = await p.evaluate(async () => {
  const imgs = [...document.querySelectorAll('a[href^="/manga/"] img')].slice(0, 8)
  // Actually decode each image to confirm the bytes load
  const results = await Promise.all(imgs.map((im) => new Promise((res) => {
    if (!im.complete) { im.onload = () => res({ ok: im.naturalWidth > 0 }); im.onerror = () => res({ ok: false }); return }
    res({ ok: im.naturalWidth > 0 })
  })))
  return {
    cards: document.querySelectorAll('a[href^="/manga/"]').length,
    imgsChecked: results.length,
    imgsLoaded: results.filter((r) => r.ok).length,
    firstSrc: imgs[0]?.src.slice(0, 60) || null,
  }
})
console.log('MANGA COVERS:', JSON.stringify(manga))
await p.screenshot({ path: path.join(OUT, 'verify-manga-covers-fixed.png') })

// ── 2. Browse genre ──────────────────────────────────────────
await p.goto('http://localhost:5173/browse?filter=genre&genreId=1', { waitUntil: 'domcontentloaded' })
await sleep(16_000)
const genre = await p.evaluate(() => ({
  cards: document.querySelectorAll('a[href^="/anime/"]').length,
  error: document.body.innerText.includes("Couldn't load results"),
  header: document.querySelector('h1')?.textContent,
}))
console.log('GENRE ACTION:', JSON.stringify(genre))
await p.screenshot({ path: path.join(OUT, 'verify-genre-live.png') })

await b.close()
console.log('DONE')
