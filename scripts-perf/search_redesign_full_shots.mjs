// Full retake of the search-redesign screenshot set (wizard pre-dismissed):
//  1. empty state        — top bar + rail + suggestions
//  2. naruto results     — poster grid loaded
//  3. genres dropdown    — open panel over results
//  4. season filtered    — Winter radio active + URL param
// Then a pixel pass over every PNG: real content (posters), dark theme,
// no black veil (the old wizard backdrop bug).
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
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

// Pre-dismiss the first-run SetupWizard — fresh profiles otherwise cover
// every page with bg-black/60 + backdrop-blur (the "black filter" bug).
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('kurodo-setup-done', '1')
  localStorage.setItem('kurodo-setup-shown', '1')
})

const shots = []
async function shot(name) {
  const fp = path.join(OUT, name)
  await p.screenshot({ path: fp })
  shots.push(fp)
  console.log('captured', name)
}

// ── 1. Empty state ────────────────────────────────────────────────
await p.goto('http://localhost:5173/search', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 2500))
await shot('search-redesign-empty.png')

// ── 2. Naruto results grid ────────────────────────────────────────
await p.click('input[type="text"]')
await p.type('input[type="text"]', 'naruto', { delay: 40 })
await new Promise((r) => setTimeout(r, 4500))
await shot('search-redesign-results.png')

// ── 3. Genres dropdown open ───────────────────────────────────────
// The Genres trigger is the dropdown button whose panel lists genres —
// located as the first top-bar dropdown after the search input.
const openedGenres = await p.evaluate(() => {
  const h2s = [...document.querySelectorAll('h2')]
  const genresH2 = h2s.find((h) => h.textContent.trim() === 'Genres')
  const btn = genresH2?.nextElementSibling?.matches('button')
    ? genresH2.nextElementSibling
    : genresH2?.parentElement?.querySelector('button')
  if (!btn) return false
  btn.click()
  return true
})
await new Promise((r) => setTimeout(r, 600))
await shot('search-redesign-genres.png')
// close it again
await p.keyboard.press('Escape')
await p.evaluate(() => document.body.click())
await new Promise((r) => setTimeout(r, 400))

// ── 4. Season filter applied ──────────────────────────────────────
const clickedWinter = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('aside button')]
  const winter = btns.find((x) => x.textContent.trim() === 'Winter')
  if (!winter) return false
  winter.click()
  return true
})
await new Promise((r) => setTimeout(r, 3500))
const url = await p.evaluate(() => location.search)
console.log('winter applied:', clickedWinter, '· url:', url)
await shot('search-redesign-filtered.png')

// ── Pixel verification of every shot ─────────────────────────────
console.log('\n── pixel verification ──')
for (const fp of shots) {
  const b64 = fs.readFileSync(fp).toString('base64')
  const stats = await p.evaluate(async (b64) => {
    const resp = await fetch(`data:image/png;base64,${b64}`)
    const bmp = await createImageBitmap(await resp.blob())
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let sum = 0, dark = 0, bright = 0, n = 0
    for (let i = 0; i < data.length; i += 4 * 53) {
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
      sum += lum; if (lum < 0.15) dark++; if (lum > 0.75) bright++; n++
    }
    return {
      meanLum: +(sum / n).toFixed(3),
      darkShare: +(dark / n).toFixed(2),
      brightShare: +(bright / n).toFixed(3),
    }
  }, b64)
  // A blocked (wizard-veiled) shot reads as meanLum ≈ 0.07–0.14 with
  // brightShare ≈ 0. Healthy results shots read ≈ 0.3 with visible posters.
  const ok = stats.meanLum > 0.15 || stats.brightShare > 0.02
  console.log(path.basename(fp), JSON.stringify(stats), ok ? 'OK' : 'LOOKS BLOCKED')
}

await b.close()
console.log('\nDONE')
