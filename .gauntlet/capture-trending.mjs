// Fast post-boot capture of the Trending ghost-numeral rail.
// Retries until the app appears, then shoots within seconds.
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpUp() {
  try {
    const r = await fetch('http://127.0.0.1:9222/json/version')
    return r.ok
  } catch { return false }
}

for (let i = 0; i < 24; i++) {
  if (await cdpUp()) break
  await sleep(4000)
}
if (!(await cdpUp())) { console.log('NO APP'); process.exit(2) }

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await b.pages()
const page = pages.find((p) => p.url().includes('localhost:5173')) || pages[0]
try { await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 }) } catch {}
await sleep(6000)

let best = null
for (let a = 0; a < 5 && !best; a++) {
  try {
    const found = await page.evaluate(() => {
      const t = [...document.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('Trending Now'))
      if (t) t.scrollIntoView({ block: 'center' })
      return !!t
    })
    if (found) await sleep(2500)
    const nums = found ? await page.evaluate(() => {
      const n = [...document.querySelectorAll('section span')].filter((s) => {
        const st = getComputedStyle(s); const t = (s.textContent || '').trim()
        return /^\d{2}$/.test(t) && parseFloat(st.fontSize) > 60
      })
      return { count: n.length, first: n.slice(0, 6).map((x) => x.textContent) }
    }).catch(() => null) : null
    if (found && nums && nums.count > 0) { best = nums }
    else { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6)); await sleep(3000) }
  } catch { /* frame reset */ await sleep(2500) }
}
console.log('rail:', JSON.stringify(best))
await page.screenshot({ path: path.join(ROOT, 'screenshots/gauntlet-trending-rail.png') }).catch(() => {})
console.log('shot saved')
await b.disconnect()
process.exit(best ? 0 : 1)
