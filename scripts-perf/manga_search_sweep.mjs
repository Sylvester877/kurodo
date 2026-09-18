// manga search + manga browse + reader sweep — proves every manga search surface
// is alive after the empty-success fallback fix.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://127.0.0.1:5173'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(name, route, waitMs = 3000) {
  console.log(`→ ${name}  ${route}`)
  await p.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await sleep(waitMs)
  const file = path.join(OUT, `${name}.png`)
  await p.screenshot({ path: file, fullPage: false })
  console.log(`  saved ${name}.png  ${fs.statSync(file).size} bytes`)
}

// 1) /manga initial (trending feed)
await shot('sweep-manga-browse', '/manga', 4500)

// 2) /manga with manga search active — proves the search bar + fallback grid (search?q via hash not supported, so we type)
await p.goto(`${BASE}/manga`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await sleep(2500)
await p.evaluate(() => {
  const el = document.querySelector('input[placeholder*=\"100k+ manga\"]') || document.querySelector('input[placeholder*=\"Search manga\"]') || document.querySelector('input[type=\"text\"]')
  if (el) { el.focus(); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })) }
})
await p.type('input[placeholder*=\"manga\"], input[type=\"text\"]', 'Bleach', { delay: 60 })
await sleep(2200)
await p.screenshot({ path: path.join(OUT, 'sweep-manga-browse-search.png'), fullPage: false })
console.log('  saved sweep-manga-browse-search.png')

// 3) Navbar dropdown — type Bleach on Home (proves manga results appear from ANY page, not just /manga)
await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await sleep(2500)
await p.evaluate(() => window.scrollTo(0, 0))
await sleep(600)
// click the navbar search pill to open dropdown
const opened = await p.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Search anime') || b.textContent?.includes('Search manga'))
  if (btn) { btn.click(); return true }
  return false
})
console.log(`  navbar search pill clicked: ${opened}`)
await sleep(800)
await p.type('input[placeholder*=\"Search anime\"], input[placeholder*=\"Search manga\"]', 'Bleach', { delay: 60 })
await sleep(2200)
await p.screenshot({ path: path.join(OUT, 'sweep-navbar-dropdown-bleach.png'), fullPage: false })
console.log('  saved sweep-navbar-dropdown-bleach.png')

// 4) /search manga tab (proves the full /search anime+manga split with Bleach query)
await shot('sweep-search-manga-tab', '/search?q=Bleach&type=manga', 5000)

// 5) Reader — still intact after search changes (pill + spine visible)
await shot('sweep-reader-after-search-fix', '/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13', 4500)

await b.close()
console.log('Done — 5 shots in screenshots/sweep-*.png')
