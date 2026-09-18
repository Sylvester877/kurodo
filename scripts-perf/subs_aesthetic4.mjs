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

async function shoot(label, url, grid) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 55000 })
  const t0 = Date.now()
  while (Date.now() - t0 < 45000) {
    const ok = await p.evaluate(() => { const v=document.querySelector('video'); return !!v && v.textTracks && v.textTracks.length>0 })
    if (ok) break
    await sleep(700)
  }
  await p.evaluate(() => { const v=document.querySelector('video'); if(v){ v.muted=true; v.play().catch(()=>{}) } })
  await sleep(1200)
  const which = await p.evaluate(() => {
    const v=document.querySelector('video'); const tt=v?.textTracks?.[0]
    return { nTracks: v?.textTracks?.length||0, mode: tt?.mode }
  })
  console.log(label, 'nTracks', which.nTracks, 'mode', which.mode)
  let got = null
  for (const s of grid) {
    await p.evaluate(sec => { const v=document.querySelector('video'); if(v) v.currentTime=sec }, s)
    for (let k=0;k<6;k++) {
      await sleep(700)
      const info = await p.evaluate(() => {
        const v=document.querySelector('video'); const tt=v?.textTracks?.[0]; const ac=tt?.activeCues
        const txt = ac && ac.length ? Array.from(ac).map(c=>c.text).join(' | ') : ''
        return { txt: txt.slice(0,220), n: ac?.length||0, mode: tt?.mode }
      })
      if (info.n>0 && info.txt.trim().length>2) { got={ s, ...info }; break }
    }
    if (got) break
  }
  console.log(label, 'chosen', got ? `t=${got.s}s "${got.txt}" n=${got.n}` : 'NONE')
  if (got) { await sleep(500); await p.mouse.move(12,12); await sleep(250) }
  else { await p.evaluate(sec => { const v=document.querySelector('video'); if(v) v.currentTime=sec }, grid[1]); await sleep(700) }
  await p.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: false })
  console.log('shot', `${label}.png`)
  await p.close()
}

// Wide grids — dialogue is sparse in first 5s; scan deeper
await shoot('subs-aesthetic-onepiece-final', `${BASE}/watch/21?ep=1`,  [3, 6, 11, 22, 38, 62, 85, 130, 200, 360])
await shoot('subs-aesthetic-bleach-final',   `${BASE}/watch/269?ep=1`, [8, 22, 38, 55, 80, 115, 150, 210, 300])

// Also one home/browse CC-badge proof from the live build
{
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900 })
  await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(2500)
  await p.screenshot({ path: path.join(OUT, 'subs-aesthetic-home-final.png'), fullPage: false })
  console.log('shot subs-aesthetic-home-final.png')
  await p.close()
}
await b.close()
console.log('done v4')
