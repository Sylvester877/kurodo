// Visual check: Manga tab of /search?q=one piece — every MangaDex-fallback
// cover must decode (no broken-image boxes). Screenshot for the user.
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
try {
  await p.goto('http://127.0.0.1:5173/search?q=one+piece', { waitUntil: 'domcontentloaded', timeout: 45000 })
  // Dismiss onboarding if present
  await p.keyboard.press('Escape').catch(() => {})
  // Open the Manga tab
  await p.waitForFunction(() => {
    const btns = [...document.querySelectorAll('button')]
    return btns.some((x) => /^manga$/i.test(x.textContent.trim()))
  }, { timeout: 20000 })
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => /^manga$/i.test(x.textContent.trim()))
    btn.click()
  })
  // Wait for MangaDex fallback notice or result cards
  await p.waitForFunction(() => document.querySelectorAll('a[href^="/manga/"]').length > 3, { timeout: 60000 })
  await new Promise((r) => setTimeout(r, 9000)) // allow lazy covers to fetch

  const stats = await p.evaluate(() => {
    const imgs = [...document.querySelectorAll('a[href^="/manga/"] img')]
    let loaded = 0, broken = 0, pending = 0
    for (const im of imgs) {
      if (!im.complete) pending++
      else if (im.naturalWidth > 10) loaded++
      else broken++
    }
    return { total: imgs.length, loaded, broken, pending }
  })
  console.log('COVER STATS', JSON.stringify(stats))
  await p.screenshot({ path: path.join(OUT, 'md-covers-fixed.png') })
  console.log('saved screenshots/md-covers-fixed.png')
} catch (e) {
  console.log('PROBE FAIL:', e.message)
  await p.screenshot({ path: path.join(OUT, 'md-covers-probe-fail.png') }).catch(() => {})
} finally {
  await b.close()
}
