// Capture https://onisaga.com/home and local http://127.0.0.1:5173/ side-by-side
// for the Onisaga Home rebuild comparison.
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
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--ignore-certificate-errors'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1) Onisaga home — full + above-fold
console.log('→ Onisaga https://onisaga.com/home')
try {
  await p.goto('https://onisaga.com/home', { waitUntil: 'networkidle2', timeout: 30_000 })
  await sleep(4000)
  await p.screenshot({ path: path.join(OUT, 'ref-onisaga-home.png'), fullPage: true })
  console.log('  saved ref-onisaga-home.png')
  await p.setViewport({ width: 1440, height: 900 })
  await p.goto('https://onisaga.com/home', { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await sleep(3000)
  await p.screenshot({ path: path.join(OUT, 'ref-onisaga-home-above.png'), fullPage: false })
  console.log('  saved ref-onisaga-home-above.png')
  // Probe structure
  const probe = await p.evaluate(() => {
    const body = document.body.innerText.slice(0, 2000)
    const hero = document.querySelector('[class*="hero"], [class*="Hero"], [class*="spotlight"], section')
    const nav = document.querySelector('nav, header')
    return {
      url: location.href,
      title: document.title,
      navText: nav ? nav.innerText.slice(0, 400) : null,
      bodyStart: body.slice(0, 1200),
      htmlLen: document.documentElement.outerHTML.length,
      sectionCount: document.querySelectorAll('section').length,
      imgCount: document.querySelectorAll('img').length,
    }
  })
  console.log(JSON.stringify(probe, null, 2))
} catch (e) {
  console.error('Onisaga fetch failed:', e.message)
  // fallback — try http
  try {
    await p.goto('https://onisaga.com/home', { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await sleep(3000)
    await p.screenshot({ path: path.join(OUT, 'ref-onisaga-home.png'), fullPage: true })
    console.log('  fallback saved')
  } catch (e2) { console.error('fallback also failed', e2.message) }
}

// 2) Local Home above-fold + full for delta
console.log('→ Local http://127.0.0.1:5173/')
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
await sleep(3500)
await p.screenshot({ path: path.join(OUT, 'local-home-before-onisaga.png'), fullPage: true })
console.log('  saved local-home-before-onisaga.png')
await p.screenshot({ path: path.join(OUT, 'local-home-before-onisaga-above.png'), fullPage: false })
console.log('  saved local-home-before-onisaga-above.png')

await b.close()
console.log('Done')
