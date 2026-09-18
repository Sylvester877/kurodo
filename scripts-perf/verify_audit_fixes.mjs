// Verify the audit fixes live:
//  1. Home Recent Episodes row: renders cards via Jikan fallback (not silently empty)
//  2. Search manga tab: "one piece" returns MangaDex fallback results despite AniList 403
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 1. Home: Recent Episodes row ─────────────────────────────
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' })
await sleep(25_000)
const home = await p.evaluate(() => {
  const sections = [...document.querySelectorAll('section')]
  const recent = sections.find((s) => s.textContent.includes('Recent Episodes'))
  if (!recent) return { found: false }
  const outage = recent.textContent.includes("Couldn't load recent episodes")
  const cards = recent.querySelectorAll('a[href^="/watch/"]').length
  const body = recent.textContent
  return { found: true, outage, cards, hasTitles: cards > 0 }
})
console.log('RECENT EPISODES:', JSON.stringify(home))
await p.evaluate(() => {
  const s = [...document.querySelectorAll('section')].find((x) => x.textContent.includes('Recent Episodes'))
  s?.scrollIntoView()
})
await sleep(1_500)
await p.screenshot({ path: path.join(OUT, 'verify-recent-episodes-outage.png') })

// ── 2. Search manga tab: one piece ───────────────────────────
await p.goto('http://localhost:5173/search?q=one%20piece', { waitUntil: 'domcontentloaded' })
await sleep(6_000)
// switch to Manga tab
const tabClicked = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const m = btns.find((el) => el.textContent.trim() === 'Manga')
  if (m) { m.click(); return true }
  return false
})
console.log('MANGA TAB CLICKED:', tabClicked)
await sleep(18_000)
const manga = await p.evaluate(() => {
  const body = document.body.innerText
  return {
    noResults: body.includes('No manga results'),
    searchFailed: body.includes('Search failed'),
    mangaCards: document.querySelectorAll('a[href^="/manga/"]').length,
    firstTitle: document.querySelector('a[href^="/manga/"] h3, a[href^="/manga/"] p')?.textContent || null,
  }
})
console.log('MANGA SEARCH:', JSON.stringify(manga))
await p.screenshot({ path: path.join(OUT, 'verify-search-manga-fallback.png') })

await b.close()
console.log('DONE')
