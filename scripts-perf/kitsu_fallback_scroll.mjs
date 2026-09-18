// Scroll the full Home page so lazy-mounted rows fire their queries, then
// verify each section heading has cards (not error states) after the
// AniList→Kitsu fallback.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const errs = []
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })

await p.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 })

// Scroll the entire page in steps so every LazyMount triggers, pausing for
// the Kitsu fallback (~1-4s server-side per row) between steps.
const results = []
const headings = ['Trending Now', 'Popular This Season', 'Most Favorite', 'Coming Soon', 'Top 10', 'Recent Episodes', 'Continue Watching']
for (let y = 0; y < 5; y++) {
  await p.evaluate((dy) => window.scrollBy(0, dy), 1400)
  await new Promise((r) => setTimeout(r, 3500))
}
await new Promise((r) => setTimeout(r, 6000))
// Final pass back to top so hero also settles
await p.evaluate(() => window.scrollTo(0, 0))
await new Promise((r) => setTimeout(r, 3000))

const out = await p.evaluate(() => {
  const text = document.body.innerText || ''
  const errorRows = (text.match(/Couldn't load this row/g) || []).length
  const retries = (text.match(/Retry/g) || []).length
  const animeLinks = [...new Set([...document.querySelectorAll('a[href^="/anime/"]')].map((a) => a.getAttribute('href')))]
  const headingCheck = {}
  for (const h of ['Trending Now', 'Popular This Season', 'Most Favorite', 'Coming Soon', 'Top 10', 'Recent Episodes']) {
    const idx = text.indexOf(h)
    headingCheck[h] = idx >= 0 ? text.slice(idx, idx + 260).replace(/\n+/g, ' | ').slice(0, 180) : '(missing)'
  }
  return { errorRows, retries, animeLinkCount: animeLinks.length, headingCheck }
})
console.log(JSON.stringify(out, null, 1))
console.log('console errors:', errs.slice(0, 10))
await p.screenshot({ path: 'screenshots/kitsu-fallback-full.png' })
await b.close()
