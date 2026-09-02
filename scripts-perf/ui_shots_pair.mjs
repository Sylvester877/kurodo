// Before/after pair shots with dynamics FROZEN so pixel diffs show only
// the intended UI changes — not carousel rotation or the login AMV.
// Usage: node scripts-perf/ui_shots_pair.mjs <port> <label>
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const LABEL = process.argv[3] || 'snap'
const PORT = process.argv[2] || '5173'
const BASE = `http://localhost:${PORT}`
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

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
// /login auto-redirects to AniList — block it so the gate stays for the shot
await page.setRequestInterception(true)
page.on('request', (req) => {
  if (/anilist\.co/.test(req.url())) req.abort().catch(() => {})
  else req.continue().catch(() => {})
})

// Freeze all motion: kill animations/transitions, pause + seek videos,
// rewind any swiper carousels to the first slide, stop blink/pulse.
const freeze = () =>
  page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }`
    document.head.appendChild(style)
    document.querySelectorAll('video').forEach((v) => {
      try {
        v.pause()
        v.currentTime = 1
      } catch { /* not seekable yet */ }
    })
    document.querySelectorAll('.swiper-wrapper').forEach((w) => {
      w.style.transform = 'translate3d(0px, 0px, 0px)'
      w.style.transition = 'none'
    })
    window.scrollTo(0, 0)
  })

for (const [name, urlPath] of PAGES) {
  try {
    if (name === 'login') {
      await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await new Promise((r) => setTimeout(r, 2500))
    } else {
      await page.goto(`${BASE}${urlPath}`, { waitUntil: 'networkidle2', timeout: 45000 })
      await new Promise((r) => setTimeout(r, 2500))
    }
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /skip setup/i.test(x.textContent || ''))
      if (b) b.click()
    })
    await new Promise((r) => setTimeout(r, 700))
    await freeze()
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({ path: path.join(OUT, `loop-${LABEL}-${name}.png`) })
    console.log(`✓ loop-${LABEL}-${name}.png`)
  } catch (e) {
    console.log(`✗ ${name}: ${String(e.message).slice(0, 90)}`)
  }
}
await browser.close()
