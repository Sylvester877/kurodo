// Minimal: manga covers load check only (no genre page — probe was hanging there).
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
await p.goto('http://localhost:5173/search?q=one%20piece', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise((r) => setTimeout(r, 6000))
await p.evaluate(() => { [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Manga')?.click() })
await new Promise((r) => setTimeout(r, 14000))
const manga = await p.evaluate(async () => {
  const imgs = [...document.querySelectorAll('a[href^="/manga/"] img')].slice(0, 8)
  const results = await Promise.all(imgs.map((im) => new Promise((res) => {
    if (!im.complete) { im.onload = () => res(im.naturalWidth > 0); im.onerror = () => res(false); setTimeout(() => res(false), 5000); return }
    res(im.naturalWidth > 0)
  })))
  return {
    cards: document.querySelectorAll('a[href^="/manga/"]').length,
    checked: results.length,
    loaded: results.filter(Boolean).length,
    firstSrc: imgs[0]?.src.slice(0, 70) || null,
  }
})
console.log('MANGA COVERS:', JSON.stringify(manga))
await p.screenshot({ path: path.join(OUT, 'verify-manga-covers-fixed.png'), timeout: 15000 })
await b.close()
console.log('DONE')
process.exit(0)
