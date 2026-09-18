// Verify the outage-hardening round on the LIVE app (localhost:5173):
//  1. /browse?filter=popular        → card grid paints (Kitsu popular stage)
//  2. /anime/57555                  → full details (Kitsu detail stage)
//  3. /search?q=naruto              → real results (Kitsu search stage)
//  4. /manga                        → trending grid paints, no duplicate empties
//  5. /manga search "naruto"        → results (MangaDex fallback)
// Screenshots into screenshots/verify-*.png
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 140)) })
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)))

const results = {}

// 1. Browse → Popular
await page.goto(`${BASE}/browse?filter=popular`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(9000)
const popularCards = await page.$$eval('a[href^="/anime/"]', (as) => as.length)
const popularError = await page.evaluate(() => document.body.innerText.includes("Couldn't load") || document.body.innerText.includes('No anime found'))
await page.screenshot({ path: path.join(OUT, 'verify-browse-popular.png') })
results['browse popular'] = { cards: popularCards, errorShown: popularError, consoleErrors: errors.length }
errors.length = 0

// 2. Anime details 57555
await page.goto(`${BASE}/anime/57555`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(9000)
const detail = await page.evaluate(() => ({
  title: document.title,
  bodyHasReze: document.body.innerText.includes('Reze') || document.body.innerText.includes('Chainsaw Man'),
  failed: document.body.innerText.includes("Couldn't load anime") || document.body.innerText.includes('Unable to load') || document.body.innerText.includes('details could not be loaded'),
}))
await page.screenshot({ path: path.join(OUT, 'verify-anime-57555.png') })
results['anime 57555'] = detail
errors.length = 0

// 3. Search naruto (advanced search page)
await page.goto(`${BASE}/search?q=naruto`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(9000)
const search = await page.evaluate(() => ({
  bodyHasNaruto: document.body.innerText.toLowerCase().includes('naruto'),
  noResults: document.body.innerText.includes('No results') || document.body.innerText.includes('Anime (0)'),
  cardCount: document.querySelectorAll('a[href^="/anime/"]').length,
}))
await page.screenshot({ path: path.join(OUT, 'verify-search-naruto.png') })
results['search naruto'] = search
errors.length = 0

// 4. Manga home (trending — MangaDex fallback during AniList outage)
await page.goto(`${BASE}/manga`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(9000)
const manga = await page.evaluate(() => {
  const text = document.body.innerText
  return {
    cardCount: document.querySelectorAll('a[href^="/manga/"]').length,
    noMangaFound: text.includes('No manga found'),
    mangadexNotice: text.includes('via MangaDex'),
    emptyStateCount: (text.match(/No manga found/g) || []).length,
  }
})
await page.screenshot({ path: path.join(OUT, 'verify-manga-trending.png') })
results['manga trending'] = manga
errors.length = 0

// 5. Manga search "naruto"
await page.type('input[placeholder*="Search manga"]', 'naruto', { delay: 40 })
await sleep(5000)
const mangaSearch = await page.evaluate(() => {
  const text = document.body.innerText
  return {
    cardCount: document.querySelectorAll('a[href^="/manga/"]').length,
    emptyDuplicates: (text.match(/No manga found/g) || []).length,
    hasNaruto: text.toLowerCase().includes('naruto'),
    mangadexNotice: text.includes('via MangaDex'),
  }
})
await page.screenshot({ path: path.join(OUT, 'verify-manga-search.png') })
results['manga search naruto'] = mangaSearch

await browser.close()
console.log(JSON.stringify(results, null, 2))
