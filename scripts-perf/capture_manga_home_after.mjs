// Capture /manga (the manga home) after Onisaga polish
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
const sleep = (ms) => new Promise(r=> setTimeout(r, ms))

console.log('→ /manga above-fold')
await p.goto('http://127.0.0.1:5173/manga', { waitUntil: 'domcontentloaded', timeout: 30_000 })
await sleep(4000)
await p.screenshot({ path: path.join(OUT, 'manga-home-after-above.png'), fullPage: false })
console.log('  saved manga-home-after-above.png')
await p.screenshot({ path: path.join(OUT, 'manga-home-after-full.png'), fullPage: true })
console.log('  saved manga-home-after-full.png')

console.log('→ / above-fold (anime Home — should be unchanged)')
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
await sleep(4000)
await p.screenshot({ path: path.join(OUT, 'anime-home-after-manga-fix-above.png'), fullPage: false })
console.log('  saved anime-home-after-manga-fix-above.png')

await b.close()
console.log('Done')
