// A–Z browse mode verification: alphabet bar present, letter B shows only
// B-titles, switching to letter D swaps content. Screenshot into screenshots/.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = 'screenshots'

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200))
})

const log = (...a) => console.log(...a)

// ── 1. Browse → A–Z · B ──
await page.goto('http://127.0.0.1:5173/browse?filter=az&letter=B', {
  waitUntil: 'networkidle2',
  timeout: 60000,
})
await new Promise((r) => setTimeout(r, 3000))

// Alphabet bar present?
const letterCount = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button[aria-label^="Anime starting with"]')]
  return { count: btns.length, letters: btns.map((b) => b.textContent.trim()) }
})
log('alphabet bar letters:', letterCount.count, '→', letterCount.letters.slice(0, 5) + '…' + letterCount.letters.slice(-2))

// Header shows A–Z · B?
const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim())
log('header:', h1)

// Title cards loaded + all start with B
await page.waitForFunction(
  () => {
    const links = [...document.querySelectorAll('a[href^="/anime/"]')]
    return links.length >= 4
  },
  { timeout: 60000 },
)
await new Promise((r) => setTimeout(r, 4000))
const titles = await page.evaluate(() => {
  const seen = new Set()
  return [...document.querySelectorAll('a[href^="/anime/"]')]
    .map((a) => a.querySelector('p')?.textContent?.trim() || a.getAttribute('aria-label') || '')
    .filter((t) => t && !seen.has(t) && seen.add(t))
    .slice(0, 30)
})
log('card titles:', titles.slice(0, 8), '… total', titles.length)
const nonB = titles.filter((t) => !/^b[^a-z]|^b[a-z]/i.test(t))
log('non-B visible titles:', nonB.length ? nonB.slice(0, 3) : 'none')
await page.screenshot({ path: `${OUT}/az-letter-B.png` })

// ── 2. Click letter D — content swaps ──
const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button[aria-label^="Anime starting with"]')]
    .find((b) => b.textContent.trim() === 'D')
  if (btn) { btn.click(); return true }
  return false
})
log('clicked D:', clicked)
await new Promise((r) => setTimeout(r, 12000))
const h1b = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim())
log('header after D click:', h1b)
const url = page.url()
log('url after D click:', url.replace('http://127.0.0.1:5173', ''))
await page.screenshot({ path: `${OUT}/az-letter-D.png` })

log('console errors:', errors.length ? errors.slice(0, 4) : 'none')
await browser.close()
