import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const BASE = 'http://127.0.0.1:5173'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

// Use One Piece MAL 21 — proven: our API returns 200 + 1 English sub via megavid
const WATCH_URL = `${BASE}/watch/21?ep=1`

async function shot(label, url, fn) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  if (fn) await fn(p)
  await p.screenshot({ path: path.join(OUT, label), fullPage: false })
  console.log('shot', label)
  await p.close()
}

await shot('subs-proof-home2.png', `${BASE}/`, async (p) => {
  await sleep(3800)
  await p.evaluate(() => window.scrollTo(0, 620))
  await sleep(800)
  await p.evaluate(() => {
    document.querySelectorAll('span').forEach((el) => {
      if (el.textContent?.trim() === 'CC') { el.style.outline = '2px solid #22d3ee'; el.style.outlineOffset = '2px' }
    })
  })
  await sleep(300)
})

await shot('subs-proof-browse2.png', `${BASE}/browse`, async (p) => {
  await sleep(3800)
  await p.evaluate(() => {
    document.querySelectorAll('span').forEach((el) => {
      if (el.textContent?.trim() === 'CC') { el.style.outline = '2px solid #22d3ee'; el.style.outlineOffset = '2px' }
    })
  })
  await sleep(300)
})

{
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(WATCH_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  const t0 = Date.now()
  let ok = false
  while (Date.now() - t0 < 55000) {
    ok = await p.evaluate(() => !!document.querySelector('button[aria-label=\"Captions\"], button[title=\"Captions\"], [data-testid=\"captions-btn\"]') || document.body.innerText.includes('Captions'))
    const state = await p.evaluate(() => document.body.innerText.slice(0, 1200))
    if (ok) { console.log('CC appeared after', Date.now() - t0); break }
    // also log whether we're still in loading vs error
    if ((Date.now() - t0) % 5000 < 900) console.log('waiting… excerpt:', state.slice(0, 180).replace(/\n/g, ' | '))
    await sleep(700)
  }
  console.log('CC found?', ok, 'elapsed', Date.now() - t0)
  await sleep(600)
  // open the CC menu
  await p.evaluate(() => {
    const btn = document.querySelector('button[aria-label=\"Captions\"]') || document.querySelector('button[title=\"Captions\"]')
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(700)
  const dbg = await p.evaluate(() => ({
    hasEnglish: document.body.innerText.includes('English'),
    hasOff: document.body.innerText.includes('Off'),
    tracks: (() => { const v = document.querySelector('video'); return v?.textTracks ? Array.from(v.textTracks).map(t => ({ label: t.label, mode: t.mode, lang: t.language })) : [] })(),
    excerpt: document.body.innerText.slice(0, 1400),
  }))
  console.log('dbg', JSON.stringify(dbg, null, 2).slice(0, 2000))
  await p.screenshot({ path: path.join(OUT, 'subs-proof-watch-onepiece-ccopen.png'), fullPage: false })
  console.log('shot subs-proof-watch-onepiece-ccopen.png')
  // also grab a shot with video playing (scroll just in case)
  await sleep(1200)
  await p.screenshot({ path: path.join(OUT, 'subs-proof-watch-onepiece-playing.png'), fullPage: false })
  console.log('shot subs-proof-watch-onepiece-playing.png')
  await p.close()
}

await b.close()
console.log('done')
