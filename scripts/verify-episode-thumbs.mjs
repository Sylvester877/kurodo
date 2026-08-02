// Verify real per-episode thumbnails render on the WATCH page (Bleach 269).
// Tracks network requests to see if the enrichment query fires, then
// samples the episode sidebar tiles in the default range and the 351-366 range.
// Usage: node scripts/verify-episode-thumbs.mjs
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin())

const TARGET = process.env.TARGET_URL || 'http://localhost:5173/watch/269?ep=1'

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })

// Track relevant network requests + capture episode-thumbs RESPONSE
const net = []
page.on('request', (req) => {
  const u = req.url()
  if (u.includes('episode-thumbs') || u.includes('jikan/anime/269/episodes') || u.includes('/img?')) {
    net.push(`${req.method()} ${u.slice(0, 120)}`)
  }
})
page.on('response', async (res) => {
  const u = res.url()
  if (u.includes('episode-thumbs/269')) {
    let body = null
    try {
      const j = await res.json()
      const eps = j?.data?.eps || {}
      body = { status: res.status(), keys: Object.keys(eps).length, sample351: eps['351'] || null }
    } catch (e) {
      body = { status: res.status(), parseError: String(e).slice(0, 80) }
    }
    net.push('EPISODE-THUMBS RESPONSE: ' + JSON.stringify(body))
  }
})

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160))
})
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + String(err).slice(0, 160)))

let loadError = null
try {
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 })
} catch (e) {
  loadError = e.message
}

await new Promise((r) => setTimeout(r, 15000))

if (loadError) {
  console.log('LOAD_ERROR:', loadError)
}

// Sample the DEFAULT range (1-25): eps 22-25 need TMDB images
const sampleImgs = async (label) => {
  const data = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img')).filter(
      (i) => (i.src || '').includes('/img?') || (i.src || '').includes('image.tmdb.org'),
    )
    const tmdb = imgs.filter((i) => decodeURIComponent(i.src).includes('image.tmdb.org'))
    const cards = imgs.filter((i) => (i.src || '').includes('card=1'))
    const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0)
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0)
    return {
      visible: imgs.length,
      tmdbSourced: tmdb.length,
      numberedCards: cards.length,
      loadedOk: loaded.length,
      broken: broken.length,
      sample: imgs.slice(0, 4).map((i) => decodeURIComponent(i.src).slice(0, 110)),
    }
  })
  console.log(label, JSON.stringify(data))
}

await sampleImgs('DEFAULT_RANGE:')

// Click the 351-366 range button
const rangeClicked = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button, [role="button"], a'))
  const ranges = btns.filter((b) => /(\d+)\s*[-–—]\s*(\d+)/.test((b.textContent || '').trim()))
  const pick = ranges
    .map((b) => ({ b, m: (b.textContent || '').match(/(\d+)\s*[-–—]\s*(\d+)/) }))
    .filter((x) => x.m)
    .sort((a, b2) => Number(b2.m[2]) - Number(a.m[2]))[0]
  if (pick) { pick.b.click(); return (pick.b.textContent || '').trim() }
  return null
})
console.log('RANGE_CLICKED:', rangeClicked)
await new Promise((r) => setTimeout(r, 6000))
await sampleImgs('RANGE_351_366:')

console.log('NET_REQUESTS:', JSON.stringify(net.slice(0, 30), null, 1))
console.log('CONSOLE_ERRORS:', JSON.stringify(consoleErrors.slice(0, 8)))

try {
  await page.screenshot({ path: 'release/thumbs-watch-check.png' })
  console.log('screenshot: release/thumbs-watch-check.png')
} catch { /* ignore */ }

await browser.close()
console.log('DONE')
