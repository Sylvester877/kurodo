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
async function cap(label, url, cueSec) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 55000 })
  const t0 = Date.now()
  while (Date.now() - t0 < 55000) {
    const has = await p.evaluate(() => !!document.querySelector('button[aria-label=\"Captions\"], button[title=\"Captions\"]'))
    if (has) break
    await sleep(700)
  }
  await p.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(()=>{}) } })
  await sleep(1000)
  await p.evaluate((s) => { const v = document.querySelector('video'); if (v) v.currentTime = s }, cueSec)
  await sleep(1700)
  const info = await p.evaluate(() => {
    const v = document.querySelector('video'); const tt = v?.textTracks?.[0];
    const ac = tt?.activeCues; const txt = ac && ac.length ? Array.from(ac).map(c=>c.text).join(' | ') : ''
    return { txt: txt.slice(0, 160), n: ac?.length || 0, mode: tt?.mode }
  })
  console.log(label, 'cue', cueSec, 'n', info.n, 'txt', info.txt, 'mode', info.mode)
  await p.mouse.move(10, 10)
  await sleep(300)
  await p.screenshot({ path: path.join(OUT, `${label}-caption-aesthetic-v2.png`), fullPage: false })
  console.log('shot', `${label}-caption-aesthetic-v2.png`)
  await p.close()
}
// One Piece dialogue right at 3.5s ("Wealth, fame, power...")
await cap('subs-aesthetic-onepiece', `${BASE}/watch/21?ep=1`, 3.5)
// Bleach dialogue at 40s ("The sound resonates...")
await cap('subs-aesthetic-bleach', `${BASE}/watch/269?ep=1`, 40)
await b.close()
console.log('done v2')
