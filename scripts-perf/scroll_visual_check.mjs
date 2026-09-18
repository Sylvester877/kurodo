// Capture mid-scroll frames to visually verify reveals are pre-triggered
// (cards settled when visible) and the scroll glide looks smooth.
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 })
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /skip setup/i.test(x.textContent || ''))
  if (b) b.click()
}).catch(() => {})
await new Promise((r) => setTimeout(r, 2500))

// Slow glide to ~2800px, snapping 3 frames along the way
const targets = [1200, 2000, 2800]
for (const t of targets) {
  await page.evaluate((y) => new Promise((res) => {
    // Lenis intercepts native scroll — drive via lenis instance if present,
    // else native scrollTo with behavior smooth.
    const lenis = window.__lenis || (window.lenis)
    if (lenis?.scrollTo) lenis.scrollTo(y, { duration: 0.9 })
    else window.scrollTo({ top: y, behavior: 'smooth' })
    setTimeout(res, 1000)
  }), t)
  await page.screenshot({ path: path.join(OUT, `scroll-check-${t}.png`) })
  console.log(`captured @${t}`)
}
await browser.close()
