// Screenshots of the redesigned /search page.
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 900 })

// Pre-dismiss the first-run SetupWizard — a fresh profile shows it over
// every page with a bg-black/60 backdrop-blur, blocking all screenshots.
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('kurodo-setup-done', '1')
  localStorage.setItem('kurodo-setup-shown', '1')
})

// 1) Empty search page (top bar + rail + suggestions)
await p.goto('http://localhost:5173/search', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 2500))
await p.screenshot({ path: path.join(OUT, 'search-redesign-empty.png') })
console.log('shot 1: empty state')

// 2) Type "naruto" → results grid
await p.click('input[type="text"]')
await p.type('input[type="text"]', 'naruto', { delay: 40 })
await new Promise((r) => setTimeout(r, 4000))
await p.screenshot({ path: path.join(OUT, 'search-redesign-results.png') })
console.log('shot 2: naruto results')

// 3) Open the Season rail section + genres dropdown for filter visuals
const railButtons = await p.$$('aside button')
if (railButtons.length > 0) {
  await railButtons[0].click() // collapse Season
  await new Promise((r) => setTimeout(r, 400))
  await railButtons[0].click() // re-open
}
// open Genres dropdown (2nd dropdown button in top bar)
const dropdownBtns = await p.$$('button svg.lucide-chevron-down')
console.log('chevron buttons found:', dropdownBtns.length)
await p.screenshot({ path: path.join(OUT, 'search-redesign-rail.png') })
console.log('shot 3: rail')

await b.close()
