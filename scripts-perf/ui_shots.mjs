/**
 * Before/after screenshot capture for the UI loop.
 * Usage: node scripts-perf/ui_shots.mjs before   → screenshots/loop-before-*.png
 *        node scripts-perf/ui_shots.mjs after-1  → screenshots/loop-after-1-*.png
 */
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const LABEL = process.argv[2] || 'snap'
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5173'

const PAGES = [
  ['home', '/'],
  ['browse', '/browse'],
  ['watch-reze', '/watch/57555'],
  ['schedule', '/schedule'],
  ['seasonal', '/seasonal'],
  ['login', '/login'],
]

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
// /login auto-redirects to AniList — block that so the gate stays put for the shot
await page.setRequestInterception(true)
page.on('request', (req) => {
  if (/anilist\.co/.test(req.url())) req.abort().catch(() => {})
  else req.continue().catch(() => {})
})

for (const [name, urlPath] of PAGES) {
  try {
    if (name === 'login') {
      // /login auto-redirects to AniList (now blocked) — the gate stays rendered
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await new Promise((r) => setTimeout(r, 3000))
    } else {
      await page.goto(`${BASE}${urlPath}`, { waitUntil: 'networkidle2', timeout: 45000 })
      await new Promise((r) => setTimeout(r, 2500))
    }
    // dismiss first-run setup wizard if present
    const skip = await page.$('button')
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /skip setup/i.test(x.textContent || '')
      )
      if (b) b.click()
    })
    await new Promise((r) => setTimeout(r, 800))
    await page.screenshot({ path: path.join(OUT, `loop-${LABEL}-${name}.png`) })
    console.log(`✓ loop-${LABEL}-${name}.png`)
  } catch (e) {
    console.log(`✗ ${name}: ${String(e.message).slice(0, 90)}`)
  }
}
await browser.close()
