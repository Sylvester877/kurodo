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
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'] })
const CAPS = [
  // One Piece EP1: Gol D. Roger opening narration lands ~4-55s, then Luffy lines ~90s
  { label: 'subs-aesthetic-onepiece-dialog-v3', url: `${BASE}/watch/21?ep=1`, seeks: [4.2, 6, 14, 45, 90, 120, 300] },
  // Bleach EP1: Ichigo classroom/narration ~20-60s, Hollow fight later
  { label: 'subs-aesthetic-bleach-dialog-v3', url: `${BASE}/watch/269?ep=1`, seeks: [38, 62, 85, 130, 180, 240] },
]
for (const cap of CAPS) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(cap.url, { waitUntil: 'domcontentloaded', timeout: 55000 })
  const t0 = Date.now()
  while (Date.now() - t0 < 55000) {
    const ok = await p.evaluate(() => !!document.querySelector('video') && !!document.querySelector('video').textTracks?.length)
    if (ok) break
    await sleep(700)
  }
  await p.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(()=>{}) } })
  await sleep(1800)
  const which = await p.evaluate(() => {
    const v = document.querySelector('video'); const tt = v?.textTracks?.[0]
    return { mode: tt?.mode, nTracks: v?.textTracks?.length || 0, activeCuesN: tt?.activeCues?.length || 0 }
  })
  console.log(cap.label, 'tracks', which.nTracks, 'mode', which.mode, 'active', which.activeCuesN)
  // Poll cues until we find a non-empty line (up to 40s wall)
  let got = null
  outer: for (const s of cap.seeks) {
    await p.evaluate((sec) => { const v = document.querySelector('video'); if (v) v.currentTime = sec }, s)
    for (let k = 0; k < 8; k++) {
      await sleep(700)
      const info = await p.evaluate(() => {
        const v = document.querySelector('video'); const tt = v?.textTracks?.[0]; const ac = tt?.activeCues
        const txt = ac && ac.length ? Array.from(ac).map(c=>c.text).join(' | ') : ''
        return { txt: txt.slice(0, 180), n: ac?.length||0, mode: tt?.mode }
      })
      if (info.n > 0 && info.txt.trim().length > 2) { got = { s, ...info }; break outer }
    }
  }
  console.log(cap.label, 'chosen', got || 'NONE (between-cues)')
  if (got) {
    // let the cue's pill render a frame before screenshot
    await sleep(400)
    await p.mouse.move(10, 10); await sleep(250)
  } else {
    // fallback: stay at first seek so we at least show the pill's box (even if between cues)
    await p.evaluate((sec) => { const v=document.querySelector('video'); if(v) v.currentTime=sec }, cap.seeks[0])
    await sleep(600)
  }
  await p.screenshot({ path: path.join(OUT, `${cap.label}.png`), fullPage: false })
  console.log('shot', `${cap.label}.png`, got ? `cue="${got.txt}"` : 'no-cue-frame')
  await p.close()
}
await b.close()
console.log('done v3')
