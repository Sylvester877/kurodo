import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const BASE = 'http://127.0.0.1:5173'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

async function shot(label, url, fn, fullPage = false) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  if (fn) await fn(p)
  await p.screenshot({ path: path.join(OUT, label), fullPage })
  console.log('shot', label)
  await p.close()
  return label
}

await shot('subs-proof-home3.png', `${BASE}/`, async (p) => {
  await sleep(3800)
  await p.evaluate(() => window.scrollTo(0, 650))
  await sleep(800)
  await p.evaluate(() => {
    document.querySelectorAll('span').forEach(el => { if (el.textContent?.trim() === 'CC') { el.style.outline = '2px solid #22d3ee'; el.style.outlineOffset = '2px' } })
  })
  await sleep(300)
})
await shot('subs-proof-browse3.png', `${BASE}/browse`, async (p) => {
  await sleep(3800)
  await p.evaluate(() => { document.querySelectorAll('span').forEach(el => { if (el.textContent?.trim() === 'CC') { el.style.outline = '2px solid #22d3ee'; el.style.outlineOffset = '2px' } }) })
  await sleep(300)
})
await shot('subs-proof-details-onepiece.png', `${BASE}/anime/21`, async (p) => { await sleep(3500) })

const titles = [
  { label: 'onepiece', url: `${BASE}/watch/21?ep=1`, name: 'One Piece' },
  { label: 'naruto', url: `${BASE}/watch/20?ep=1`, name: 'Naruto' },
  { label: 'bleach', url: `${BASE}/watch/269?ep=1`, name: 'Bleach' },
]

for (const t of titles) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 55000 })
  const t0 = Date.now()
  let hasCC = false
  while (Date.now() - t0 < 55000) {
    hasCC = await p.evaluate(() => !!document.querySelector('button[aria-label=\"Captions\"], button[title=\"Captions\"]'))
    if (hasCC) break
    await sleep(700)
  }
  console.log(t.label, 'CC', hasCC, 'elapsed', Date.now() - t0)
  await sleep(700)
  // open CC menu
  await p.evaluate(() => {
    const btn = document.querySelector('button[aria-label=\"Captions\"]') || document.querySelector('button[title=\"Captions\"]')
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(700)
  const dbg = await p.evaluate(() => ({
    hasEnglish: document.body.innerText.includes('English'),
    tracks: (() => { const v = document.querySelector('video'); return v?.textTracks ? Array.from(v.textTracks).map(x => ({ label: x.label, mode: x.mode })) : [] })(),
  }))
  console.log(t.label, 'dbg', dbg)
  await p.screenshot({ path: path.join(OUT, `subs-proof-watch-${t.label}-ccopen.png`), fullPage: false })
  console.log('shot', `subs-proof-watch-${t.label}-ccopen.png`)
  // try to let a cue render: seek to 30s
  try {
    await p.evaluate(() => { const v = document.querySelector('video'); if (v) v.currentTime = 30 })
    await sleep(1800)
    await p.screenshot({ path: path.join(OUT, `subs-proof-watch-${t.label}-cue.png`), fullPage: false })
    console.log('shot', `subs-proof-watch-${t.label}-cue.png`)
  } catch {}
  await p.close()
}

await b.close()
console.log('done sweep5')
