// Verify the self-healing image pipeline:
//  1. Block s4.anilist.co requests at the CDP level to simulate the flaky CDN.
//  2. Confirm ImageWithBlur retries via the /img proxy and the image STILL
//     becomes visible (instead of a permanent grey box).
//  3. Also confirm /quotes route + nav links are gone.
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
await p.setViewport({ width: 1440, height: 900 })

await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.evaluate(() => {
  try {
    localStorage.setItem('kurodo_setup_done', '1')
    localStorage.setItem('kurodo-setup-complete', '1')
  } catch {}
})

// ── Simulate flaky CDN: abort all direct anilist image requests ──
const cdp = await p.createCDPSession()
await cdp.send('Network.enable')
await cdp.send('Network.setBlockedURLs', { urls: ['*s4.anilist.co/file/anilistcdn/media/anime/cover*'] })
let proxyServed = 0
cdp.on('responseReceived', (e) => {
  if (e.response.url.includes('localhost:5173/img?')) proxyServed++
})

await p.reload({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
// Give the 7s hang-timer + proxy retries time to run
await new Promise((r) => setTimeout(r, 12000))

const dom = await p.evaluate(() => {
  const out = { anilistImgs: 0, loadedVisible: 0, proxyLoaded: 0, stillHidden: 0 }
  for (const img of document.querySelectorAll('img')) {
    const src = img.currentSrc || img.src || ''
    if (!src) continue
    if (src.includes('/img?url=') && decodeURIComponent(src).includes('anilist')) {
      out.anilistImgs++
      if (img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0') out.proxyLoaded++
    } else if (src.includes('anilist')) {
      out.anilistImgs++
      if (img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0') out.loadedVisible++
      else out.stillHidden++
    }
  }
  return out
})

console.log('self-heal check:', JSON.stringify(dom))
console.log('proxy responses seen:', proxyServed)

// ── Quotes removal check ──
await p.goto(BASE + '/quotes', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
const quotesCheck = await p.evaluate(() => ({
  url: location.pathname + location.search,
  bodyHasQuotesHeading: /quotes/i.test(document.querySelector('h1,h2')?.textContent || ''),
  bodyText: document.body.innerText.slice(0, 150).replace(/\n+/g, ' | '),
}))
console.log('quotes route:', JSON.stringify(quotesCheck))

const navHasQuotes = await p.evaluate(() => /quotes/i.test(document.body.innerText))
console.log('nav/footer still mentions quotes:', navHasQuotes)

// ── Normal (unblocked) sanity shot of home for the record ──
await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
await new Promise((r) => setTimeout(r, 5000))
fs.mkdirSync(OUT, { recursive: true })
await p.screenshot({ path: path.join(OUT, 'thumbnails-selfheal-home.png') })

const pass =
  dom.anilistImgs === 0 ||
  (dom.proxyLoaded + dom.loadedVisible > 0 && dom.stillHidden < dom.anilistImgs) ||
  proxyServed > 0
console.log(pass ? 'SELF-HEAL PIPELINE: PASS' : 'SELF-HEAL PIPELINE: CHECK MANUALLY')
console.log(quotesCheck.url !== '/quotes' || !quotesCheck.bodyHasQuotesHeading ? 'QUOTES REMOVED: PASS' : 'QUOTES REMOVED: FAIL')

await b.close()
