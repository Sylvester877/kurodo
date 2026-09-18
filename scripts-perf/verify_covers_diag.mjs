// Diagnose why covers report naturalWidth 0 despite proxy 200s:
// wait for EACH img's load/error event individually with generous timeout,
// and log one proxied URL's fetch from INSIDE the page context.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })

const coverFetches = []
p.on('response', (r) => {
  if (r.url().includes('/img?url=') || r.url().includes('mangadex')) {
    coverFetches.push(r.status() + ' ' + r.url().slice(0, 90))
  }
})

await p.goto('http://localhost:5173/search?q=one%20piece', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise((r) => setTimeout(r, 6000))
await p.evaluate(() => { [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === 'Manga')?.click() })
await new Promise((r) => setTimeout(r, 14_000))

const diag = await p.evaluate(async () => {
  const imgs = [...document.querySelectorAll('a[href^="/manga/"] img')].slice(0, 6)
  const out = []
  for (const im of imgs) {
    const r = await new Promise((res) => {
      if (im.complete) return res({ complete: true, ok: im.naturalWidth > 0, w: im.naturalWidth })
      let done = false
      im.onload = () => { done = true; res({ complete: true, ok: true, w: im.naturalWidth }) }
      im.onerror = () => { done = true; res({ complete: true, ok: false, w: 0 }) }
      setTimeout(() => { if (!done) res({ complete: false, ok: false, w: 0, stuck: true }) }, 12_000)
    })
    out.push(r)
  }
  // Also fetch one proxied cover from inside the page
  const testUrl = imgs[0]?.src
  let inPageFetch = null
  if (testUrl) {
    try {
      const resp = await fetch(testUrl, { cache: 'no-store' })
      inPageFetch = resp.status + ' len=' + (await resp.blob()).size
    } catch (e) { inPageFetch = 'FETCH_ERR ' + e.message }
  }
  return { imgs: out, inPageFetch, lazy: imgs.map((i) => i.loading).slice(0, 3) }
})
console.log('IMG STATE:', JSON.stringify(diag.imgs))
console.log('IN-PAGE FETCH:', diag.inPageFetch)
console.log('LOADING ATTR:', JSON.stringify(diag.lazy))
console.log('COVER NETWORK:'); coverFetches.slice(0, 8).forEach((c) => console.log(' ', c))
await p.screenshot({ path: path.join(OUT, 'verify-manga-covers-fixed.png'), timeout: 15000 })
await b.close()
console.log('DONE')
process.exit(0)
