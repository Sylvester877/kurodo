// Close-up review shots of every component the UI loop touched.
// Usage: node scripts-perf/touch_review_shots.mjs
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--hide-scrollbars'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })

const shot = async (name) =>
  p.screenshot({ path: path.join(OUT, `review-${name}.png`) })

// 1. Navbar + logo (header, tagline baseline)
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 2500))
await shot('navbar-logo')

// 2. Hero tab switcher (Continue Watching / Featured chips)
const heroTabs = await p.$('.glass-hero-tabs, [class*="Tab"]')
const tabs = await p.evaluateHandle(() =>
  [...document.querySelectorAll('button')].find((x) => /featured/i.test(x.textContent || ''))?.parentElement,
)
if (tabs) {
  try {
    await p.evaluate((el) => el.scrollIntoView({ block: 'center' }), tabs)
    await new Promise((r) => setTimeout(r, 800))
    const box = await (await tabs.asElement())?.boundingBox()
    if (box) {
      await p.setViewport({
        width: 1440,
        height: 900,
        deviceScaleFactor: 2,
      })
      await shot('hero-tabs')
    }
  } catch { /* best effort */ }
}

// 3. Seasonal year stepper
await p.goto('http://localhost:5173/seasonal', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 2500))
const stepper = await p.evaluateHandle(() =>
  [...document.querySelectorAll('button')].find((x) => (x.querySelector('.fa-chevron-left, svg') && x.className.includes('p-2.5')))?.parentElement,
)
try {
  const el = stepper.asElement()
  if (el) {
    const box = await el.boundingBox()
    if (box) {
      await p.evaluate((e) => e.scrollIntoView({ block: 'center' }), el)
      await new Promise((r) => setTimeout(r, 500))
      await shot('seasonal-stepper')
    }
  }
} catch { /* best effort */ }

// 4. Schedule day chips
await p.goto('http://localhost:5173/schedule', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 2500))
await shot('schedule-days')

// 5. Watch page server picker (badges + episode chips)
await p.goto('http://localhost:5173/watch/57555', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 4000))
await p.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((x) => /servers|provider/i.test(x.textContent || ''))
  el?.scrollIntoView({ block: 'start' })
})
await new Promise((r) => setTimeout(r, 600))
await shot('watch-picker')

// 6. Footer link rows
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await new Promise((r) => setTimeout(r, 800))
await shot('footer-links')

// 7. Login gate (make sure the monochrome piece still reads)
await p.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded', timeout: 20000 })
await new Promise((r) => setTimeout(r, 1500))
await shot('login-gate')

console.log('review shots done')
await b.close()
