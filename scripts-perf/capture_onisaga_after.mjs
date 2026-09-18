// Capture Home after Onisaga-inspired rebuild
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

console.log('→ Home above-fold')
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
await sleep(4000)
await p.screenshot({ path: path.join(OUT, 'onisaga-home-after-above.png'), fullPage: false })
console.log('  saved onisaga-home-after-above.png')
await p.screenshot({ path: path.join(OUT, 'onisaga-home-after-full.png'), fullPage: true })
console.log('  saved onisaga-home-after-full.png')

// Hero metrics: actual rendered height
const heroH = await p.evaluate(() => {
  const h = document.querySelector('section')
  return h ? Math.round(h.getBoundingClientRect().height) : null
})
console.log('  hero height px:', heroH)

// Quick rails probe
const railInfo = await p.evaluate(() => {
  const secs = Array.from(document.querySelectorAll('section')).map(s => {
    const r = s.getBoundingClientRect()
    const t = s.querySelector('h2')?.textContent?.trim() || s.className.slice(0,60)
    return { title: t, top: Math.round(r.top), h: Math.round(r.height) }
  })
  return secs
})
console.log(JSON.stringify(railInfo.slice(0,12), null, 2))

await b.close()
console.log('Done')
