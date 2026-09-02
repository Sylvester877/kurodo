// Play-test capture: open the watch page for a show served by the gogoanime
// fallback, wait until the <video> element is actually playing, screenshot.
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5173'
const WATCH = process.argv[2] || '/watch/197754?ep=1' // liar-game (on gogo mirror)
const OUT_NAME = process.argv[3] || 'playtest-fallback.png'

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })

console.log('navigating:', WATCH)
await page.goto(`${BASE}${WATCH}`, { waitUntil: 'domcontentloaded', timeout: 45000 })

// dismiss first-run wizard if it appears
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /skip setup/i.test(x.textContent || ''))
  if (b) b.click()
}).catch(() => {})

// Wait up to 90s for a real playing video. On 'loaded-paused', keep polling
// (autoplay can lag ~5s) and nudge play() once after 6s in case autoplay
// policy still blocks it.
const deadline = Date.now() + 90_000
let state = 'no-video'
let loadedPausedSince = 0
let nudged = false
while (Date.now() < deadline) {
  state = await page.evaluate(() => {
    const v = document.querySelector('video')
    if (!v) return 'no-video'
    if (v.readyState >= 2 && !v.paused && !v.ended && v.currentTime > 0) return 'playing'
    if (v.readyState >= 2) return 'loaded-paused'
    return 'loading'
  }).catch(() => 'probe-error')
  if (state === 'playing') break
  if (state === 'loaded-paused') {
    if (!loadedPausedSince) loadedPausedSince = Date.now()
    if (Date.now() - loadedPausedSince > 6_000 && !nudged) {
      nudged = true
      await page.evaluate(() => document.querySelector('video')?.play()?.catch(() => {})).catch(() => {})
    }
    if (Date.now() - loadedPausedSince > 25_000) break // give up honestly
  } else {
    loadedPausedSince = 0
  }
  await new Promise((r) => setTimeout(r, 1500))
}
console.log('video state:', state)

// Log the stream source for evidence
const src = await page.evaluate(() => {
  const v = document.querySelector('video')
  return (v?.currentSrc || v?.src || '').slice(0, 110)
}).catch(() => '')
console.log('video src:', src || '(none)')

await new Promise((r) => setTimeout(r, 2500))
await page.screenshot({ path: path.join(OUT, OUT_NAME) })
console.log(`✓ ${OUT_NAME} (state=${state})`)
await browser.close()
