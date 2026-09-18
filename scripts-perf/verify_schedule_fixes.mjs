// Live verification round 2: Schedule fallback state, Seasonal future copy,
// Browse letter cleanup via the real genre dropdown flow.
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
const shot = (name) => p.screenshot({ path: path.join(OUT, name) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 1. Schedule (long wait: AniList fail → parallel Jikan fallback) ──
await p.goto('http://localhost:5173/schedule', { waitUntil: 'domcontentloaded' })
await sleep(25_000)
const sched = await p.evaluate(() => {
  const body = document.body.innerText
  return {
    rows: body.match(/\d+ episodes? across 7 days/)?.[0] || null,
    outage: body.includes("Couldn't load the schedule"),
    dayBtns: [...document.querySelectorAll('aside button')].length,
    episodePills: (body.match(/EP \d+/g) || []).length,
  }
})
console.log('SCHEDULE:', JSON.stringify(sched))
await shot('verify-schedule-after.png')

// ── 2. Browse: A–Z letter=B → genre dropdown → Action ────────
await p.goto('http://localhost:5173/browse?filter=az&letter=B', { waitUntil: 'domcontentloaded' })
await sleep(6_000)
// Find the genre dropdown trigger inside the toolbar
const clicked = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const g = btns.find((el) => /genre/i.test(el.textContent) && !el.textContent.includes('A–Z'))
  if (g) { g.click(); return g.textContent.trim().slice(0, 30) }
  return null
})
console.log('GENRE TRIGGER:', clicked)
await sleep(1_500)
const afterAction = await p.evaluate(() => {
  // The open dropdown lists genres — option buttons render
  // <span>Action</span><span>2863</span>, so match on startsWith.
  const opts = [...document.querySelectorAll('button')]
  const action = opts.find((el) => {
    const t = el.textContent.trim()
    return /^Action\d*$/.test(t) || t.startsWith('Action')
  })
  if (action) { action.click(); return true }
  return false
})
console.log('CLICKED ACTION:', afterAction)
await sleep(6_000)
const genreUrl = p.url()
const cards = await p.evaluate(() => document.querySelectorAll('a[href^="/anime/"]').length)
const leaked = /[?&]letter=/.test(genreUrl)
console.log('URL:', genreUrl)
console.log('CARDS:', cards, '| LETTER LEAK:', leaked ? 'STILL PRESENT ❌' : 'CLEANED ✅')
await shot('verify-browse-genre-clean.png')

await b.close()
console.log('DONE')
