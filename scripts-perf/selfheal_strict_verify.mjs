// Strict verification of the self-healing image pipeline.
// Block anilist cover requests (simulating CDN failure), scroll a poster grid
// so lazy images actually REQUEST, then confirm they recover via the /img
// proxy and become visible.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5173'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 2400 }) // tall so many grid items are near viewport

// Block BEFORE any page load; use a fresh profile so no SW/cache interference.
const cdp = await p.createCDPSession()
await cdp.send('Network.enable')
await cdp.send('Network.setBlockedURLs', { urls: ['*anilist.co/file/anilistcdn/media/anime/cover*'] })
let proxy200 = 0
cdp.on('responseReceived', (e) => {
  if (e.response.url.includes('/img?url=') && e.response.status === 200) proxy200++
})

await p.goto(`${BASE}/search?q=one%20piece`, { waitUntil: 'domcontentloaded', timeout: 45000 })
await p.evaluate(() => {
  try {
    localStorage.setItem('kurodo_setup_done', '1')
    localStorage.setItem('kurodo-setup-complete', '1')
  } catch {}
}).catch(() => {})
await p.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})

// Scroll through the grid in steps so lazy images request (and fail → retry)
for (let y = 0; y <= 4000; y += 800) {
  await p.evaluate((yy) => window.scrollTo(0, yy), y)
  await new Promise((r) => setTimeout(r, 700))
}

// Wait past the 7s hang/error-retry window
await new Promise((r) => setTimeout(r, 11000))

const dom = await p.evaluate(() => {
  const out = { requested: 0, directVisible: 0, proxySrc: 0, proxyVisible: 0, failedVisible0: 0 }
  for (const img of document.querySelectorAll('img')) {
    const src = img.currentSrc || img.src || ''
    if (!src) continue
    const isProxy = src.includes('/img?url=')
    const isAnilist = src.includes('anilist') || (isProxy && decodeURIComponent(src).includes('anilist'))
    if (!isAnilist) continue
    out.requested++
    const visible = img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0'
    if (isProxy) {
      out.proxySrc++
      if (visible) out.proxyVisible++
    } else if (visible) out.directVisible++
    else if (img.complete && img.naturalWidth === 0) out.failedVisible0++
  }
  return out
})

console.log('strict self-heal:', JSON.stringify(dom))
console.log('proxy 200 responses observed:', proxy200)

fs.mkdirSync(OUT, { recursive: true })
await p.screenshot({ path: path.join(OUT, 'thumbnails-selfheal-search.png') })

const pass = dom.proxyVisible > 0 && dom.proxySrc > 0
console.log(pass ? 'SELF-HEAL RETRY: PASS' : 'SELF-HEAL RETRY: FAIL')

await b.close()
process.exit(pass ? 0 : 1)
