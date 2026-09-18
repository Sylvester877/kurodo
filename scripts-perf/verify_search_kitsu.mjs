// UI probe: the search page must show real results for "chainsaw man"
// during the AniList 403 + Jikan 504 dual outage (Kitsu chain).
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await p.goto('http://localhost:5173/search?q=chainsaw%20man', { waitUntil: 'domcontentloaded' })
await sleep(20_000)
const state = await p.evaluate(() => {
  const body = document.body.innerText
  return {
    count: body.match(/Anime \((\d+)\)/)?.[1] || null,
    noResults: body.includes('No results'),
    cards: document.querySelectorAll('a[href^="/anime/"]').length,
    firstTitle: document.querySelector('a[href^="/anime/"] img')?.alt || null,
  }
})
console.log('SEARCH:', JSON.stringify(state))
await p.screenshot({ path: path.join(OUT, 'verify-search-kitsu.png') })

// Second query — naruto (regression: previously 0 results)
await p.goto('http://localhost:5173/search?q=naruto', { waitUntil: 'domcontentloaded' })
await sleep(16_000)
const state2 = await p.evaluate(() => {
  const body = document.body.innerText
  return {
    count: body.match(/Anime \((\d+)\)/)?.[1] || null,
    noResults: body.includes('No results'),
    cards: document.querySelectorAll('a[href^="/anime/"]').length,
  }
})
console.log('SEARCH naruto:', JSON.stringify(state2))
await p.screenshot({ path: path.join(OUT, 'verify-search-naruto.png') })

await b.close()
console.log('DONE')
