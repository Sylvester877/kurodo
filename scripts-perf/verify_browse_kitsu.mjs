// UI probe: Browse genre + A–Z views render real cards via the Kitsu
// fallback stages, with screenshots for the gallery.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Genre: Action ────────────────────────────────────────────
await p.goto('http://localhost:5173/browse?filter=genre&genreId=1', { waitUntil: 'domcontentloaded' })
await sleep(14_000)
const genre = await p.evaluate(() => ({
  cards: document.querySelectorAll('a[href^="/anime/"]').length,
  header: document.querySelector('h1')?.textContent,
  error: document.body.innerText.includes("Couldn't load results"),
}))
console.log('GENRE ACTION:', JSON.stringify(genre))
await p.screenshot({ path: path.join(OUT, 'verify-browse-genre-kitsu.png') })

// ── A–Z: letter B ────────────────────────────────────────────
await p.goto('http://localhost:5173/browse?filter=az&letter=B', { waitUntil: 'domcontentloaded' })
await sleep(14_000)
const az = await p.evaluate(() => ({
  cards: document.querySelectorAll('a[href^="/anime/"]').length,
  header: document.querySelector('h1')?.textContent,
  error: document.body.innerText.includes("Couldn't load results"),
  titles: [...document.querySelectorAll('a[href^="/anime/"] img')]
    .slice(0, 5)
    .map((i) => i.alt)
    .filter(Boolean),
}))
console.log('AZ LETTER B:', JSON.stringify(az))
await p.screenshot({ path: path.join(OUT, 'verify-browse-az-kitsu.png') })

await b.close()
console.log('DONE')
