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

async function capture(label, url, fn) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  if (fn) await fn(p)
  await p.screenshot({ path: path.join(OUT, label), fullPage: false })
  console.log('shot', label)
  await p.close()
}

// 1) Home: show CC badges on cards + scroll rail into view
await capture('subs-proof-home.png', `${BASE}/`, async (p) => {
  await sleep(3500)
  await p.evaluate(() => window.scrollTo(0, 650))
  await sleep(800)
  // highlight CC pills for the photo
  await p.evaluate(() => {
    document.querySelectorAll('span').forEach((el) => {
      if (el.textContent?.trim() === 'CC') {
        el.style.outline = '2px solid #22d3ee'
        el.style.outlineOffset = '2px'
      }
    })
  })
  await sleep(300)
})

// 2) Watch player: load a real episode that carries English VTT (JJK S2 ep1),
//    wait for stream, click CC to open menu, screenshot with English checked.
{
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  // Use numeric AniList id in URL so router can feed it to megavid immediately
  await p.goto(`${BASE}/watch/113415?ep=1`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  // Wait until controls bar is mounted (stream loaded)
  const t0 = Date.now()
  let hasCC = false
  while (Date.now() - t0 < 45000) {
    hasCC = await p.evaluate(() => {
      const btn = document.querySelector('button[title=\"Captions\"]') || document.querySelector('button[aria-label=\"Captions\"]')
      return !!btn
    })
    if (hasCC) break
    await sleep(700)
  }
  console.log('CC button present?', hasCC, 'elapsed', Date.now() - t0)
  await sleep(800)
  // Open captions menu
  await p.evaluate(() => {
    const btn = document.querySelector('button[title=\"Captions\"]') || document.querySelector('button[aria-label=\"Captions\"]')
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(700)
  await p.screenshot({ path: path.join(OUT, 'subs-proof-watch-ccopen.png'), fullPage: false })
  console.log('shot subs-proof-watch-ccopen.png')

  // Also dump what the menu shows + whether activeSub is English
  const info = await p.evaluate(() => {
    const panel = document.body.innerHTML.slice(0, 12000)
    const hasEnglish = document.body.innerText.includes('English')
    const hasOff = document.body.innerText.includes('Off')
    const tracks = document.querySelector('video')?.textTracks ? Array.from(document.querySelector('video').textTracks).map(t => ({ label: t.label, mode: t.mode, lang: t.language })) : []
    return { hasEnglish, hasOff, bodySlice: document.body.innerText.slice(0, 1200), tracks }
  })
  console.log('menu has English/off', info.hasEnglish, info.hasOff)
  console.log('textTracks', info.tracks)
  console.log('body excerpt', info.bodySlice.slice(0, 600))
  await p.close()
}

// 3) Browse grid: CC pills visible on every card
await capture('subs-proof-browse.png', `${BASE}/browse`, async (p) => {
  await sleep(3500)
  await p.evaluate(() => {
    document.querySelectorAll('span').forEach((el) => {
      if (el.textContent?.trim() === 'CC') {
        el.style.outline = '2px solid #22d3ee'
        el.style.outlineOffset = '2px'
      }
    })
  })
  await sleep(300)
})

await b.close()
console.log('done')
