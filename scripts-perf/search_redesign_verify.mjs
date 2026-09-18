// Verify the redesigned search page structure + look:
//  • top bar labels (Search / Genres / Sort by / Year)
//  • left rail sections (Season / Format / Status / Min score)
//  • poster grid present with AnimeCard items
//  • pixel stats of the results screenshot (dark theme, content present)
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHOTS = path.join(ROOT, 'screenshots')
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 900 })

await p.goto('http://localhost:5173/search', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 2000))

const structure = await p.evaluate(() => {
  const text = document.body.innerText
  const has = (s) => text.includes(s)
  const gridCards = document.querySelectorAll('a[href^="/anime/"]').length
  return {
    topBar: {
      searchLabel: has('Search'),
      genresLabel: has('Genres'),
      sortLabel: has('Sort by'),
      yearLabel: has('Year'),
    },
    rail: {
      season: has('Season'),
      format: has('Format'),
      status: has('Status'),
      minScore: has('Min score'),
    },
    suggestionsVisible: has('Try a search'),
    gridCardsOnIdle: gridCards,
  }
})
console.log('STRUCTURE (empty):', JSON.stringify(structure, null, 2))

// Now search naruto and check the grid
await p.click('input[type="text"]')
await p.type('input[type="text"]', 'naruto', { delay: 40 })
await new Promise((r) => setTimeout(r, 4500))

const results = await p.evaluate(() => {
  const cards = document.querySelectorAll('a[href^="/anime/"]')
  const posters = document.querySelectorAll('.poster-frame img').length
  const totalText = document.body.innerText.match(/[\d,]+ results?/)?.[0] ?? null
  return { resultCards: cards.length, posterImgs: posters, totalText }
})
console.log('RESULTS (naruto):', JSON.stringify(results))

// Screenshot pixel stats — verify dark theme and non-empty content
const shot = path.join(SHOTS, 'search-redesign-results.png')
if (fs.existsSync(shot)) {
  const img = {
    b64: fs.readFileSync(shot).toString('base64'),
  }
  const stats = await p.evaluate(async (b64) => {
    const resp = await fetch(`data:image/png;base64,${b64}`)
    const blob = await resp.blob()
    const bmp = await createImageBitmap(blob)
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let sum = 0, dark = 0, n = 0
    for (let i = 0; i < data.length; i += 4 * 97) { // sparse sample
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
      sum += lum; if (lum < 0.2) dark++; n++
    }
    return { meanLum: (sum / n).toFixed(3), darkShare: (dark / n).toFixed(2), samples: n }
  }, img.b64)
  console.log('PIXELS:', JSON.stringify(stats))
}

await b.close()
