// Capture per-image load/error/aborted events via CDP to see what's really
// happening to anilist images: do they error, or just never finish?
import puppeteer from 'puppeteer'
import fs from 'node:fs'

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

// Track image requests via CDP
const cdp = await p.createCDPSession()
const events = []
await cdp.send('Network.enable')
cdp.on('responseReceived', (e) => {
  const u = e.response.url
  if (!/anilist\.co|tmdb\.org|mal-app|myanimelist/.test(u)) return
  events.push({ t: Date.now(), type: 'response', url: u, status: e.response.status, mime: e.response.mimeType })
})
cdp.on('loadingFailed', (e) => {
  const u = e.request.url
  if (!/anilist\.co|tmdb\.org|myanimelist/.test(u)) return
  events.push({ t: Date.now(), type: 'FAILED', url: u, error: e.errorText, canceled: e.canceled })
})

await p.reload({ waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
await new Promise((r) => setTimeout(r, 12000)) // generous window for slow loads

// DOM truth: how many anilist images ended up loaded vs not
const dom = await p.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 2000))
  const out = { loaded: 0, broken: 0, invisible: 0 }
  for (const img of document.querySelectorAll('img')) {
    const src = img.currentSrc || img.src || ''
    if (!src.includes('anilist')) continue
    if (img.complete && img.naturalWidth > 0) {
      if (getComputedStyle(img).opacity === '0') out.invisible++
      else out.loaded++
    } else if (img.complete) out.broken++
  }
  return out
})

console.log('DOM anilist imgs:', dom)
const fails = events.filter((e) => e.type === 'FAILED')
console.log(`\nFAILED requests: ${fails.length}`)
for (const f of fails.slice(0, 12)) console.log(`  ${f.canceled ? 'CANCELED' : 'ERROR '} (${f.error}) ${f.url.slice(0, 110)}`)
const resps = events.filter((e) => e.type === 'response')
const fromCache = resps.filter((e) => e.status === 200).length
console.log(`\nresponses 200: ${fromCache}/${resps.length}`)
const non200 = resps.filter((e) => e.status !== 200)
for (const r of non200.slice(0, 8)) console.log(`  ${r.status} ${r.url.slice(0, 110)}`)

await b.close()
