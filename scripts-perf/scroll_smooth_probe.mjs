// Scroll smoothness probe: scrolls the home page through N wheel deltas and
// measures per-frame gaps via requestAnimationFrame + Lenis scroll position.
// Reports avg frame time, max frame gap, and long-frame (>50ms) count.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 })
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /skip setup/i.test(x.textContent || ''))
  if (b) b.click()
}).catch(() => {})
await new Promise((r) => setTimeout(r, 3000))

// Start rAF frame-gap sampling, then drive wheel scrolling for ~8s
const sampler = page.evaluate(() => new Promise((resolve) => {
  const gaps = []
  let last = performance.now()
  let running = true
  const tick = (now) => {
    gaps.push(now - last)
    last = now
    if (running) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  // drive wheel events
  let n = 0
  const wheel = setInterval(() => {
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }))
    if (++n > 160) { clearInterval(wheel); setTimeout(() => { running = false; resolve(gaps) }, 1200) }
  }, 45)
  window.__scrollPos = () => window.scrollY
}))

const gaps = await sampler
gaps.shift() // first gap is warm-up
const sorted = [...gaps].sort((a, b) => a - b)
const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
const p95 = sorted[Math.floor(sorted.length * 0.95)]
const long = gaps.filter((g) => g > 50).length
const jankPct = ((long / gaps.length) * 100).toFixed(1)
console.log(`frames: ${gaps.length}`)
console.log(`avg frame: ${avg.toFixed(1)}ms  p95: ${p95.toFixed(1)}ms  max: ${sorted[sorted.length - 1].toFixed(1)}ms`)
console.log(`long frames (>50ms): ${long} (${jankPct}%)`)
const finalY = await page.evaluate(() => window.scrollY)
console.log(`scroll position after: ${Math.round(finalY)}px`)
await browser.close()
