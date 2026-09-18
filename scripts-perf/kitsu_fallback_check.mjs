// Verify the Kitsu feed fallback end-to-end: load the real Home page while
// AniList is site-down, wait for the feed rows, and confirm cards actually
// render instead of "Couldn't load this row" error states.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL = process.env.URL || 'http://127.0.0.1:5173/'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,2200'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 2100 })
const errors = []
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 160))
})
p.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)))

await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })

// Give the feed queries time to fail AniList and resolve via Kitsu.
// The Kitsu round-trips are ~0.5-4s on the server side.
await new Promise((r) => setTimeout(r, 12000))

const snapshot = await p.evaluate(() => {
  const text = document.body.innerText || ''
  const errorRows = (text.match(/Couldn't load this row/g) || []).length
  const retries = (text.match(/Retry/g) || []).length
  // AnimeCard posters render inside .poster-frame (see AnimeCard)
  const posterImgs = document.querySelectorAll('img').length
  const brokenImgs = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0).length
  // Count section headings
  const headings = ['Trending Now', 'Popular This Season', 'Most Favorite', 'Coming Soon', 'Continue Watching', 'Top 10']
    .filter((h) => text.includes(h))
  // Sample some card titles under each heading region
  const cardTitles = [...document.querySelectorAll('a[href^="/anime/"]')]
    .map((a) => a.getAttribute('href'))
    .filter((h, i, arr) => h && arr.indexOf(h) === i)
    .slice(0, 12)
  return { errorRows, retries, posterImgs, brokenImgs, headings, cardTitles, bodyLen: text.length }
})

console.log('SNapshot:', JSON.stringify(snapshot, null, 1))
console.log('console errors:', errors.slice(0, 8))

await p.screenshot({ path: 'screenshots/kitsu-fallback-home.png' })
await b.close()
