import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
await p.goto('http://127.0.0.1:5173/manga', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 5000))
const api = await p.evaluate(async () => {
  const r1 = await fetch('/api/manga/search?q=Bleach&limit=4')
  const j1 = await r1.json().catch(()=>null)
  const r2 = await fetch('/api/atsu/search?q=Bleach&limit=4')
  const j2 = await r2.json().catch(()=>null)
  return { mangadexTitles: (j1?.data?.results||[]).map(x=>x.title).slice(0,4), atsuTitles: (j2?.data?.results||[]).map(x=>x.title).slice(0,4) }
})
console.log(JSON.stringify(api, null, 2))
// re-screenshot after data loads
await new Promise(r => setTimeout(r, 2000))
await p.screenshot({ path: 'screenshots/en312-manga-browse2.png', fullPage: false })
console.log('saved en312-manga-browse2.png')
await p.goto('http://127.0.0.1:5173/manga/sVC2A?source=atsu', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{})
await new Promise(r => setTimeout(r, 4000))
await p.screenshot({ path: 'screenshots/en312-manga-details-atsu.png', fullPage: false })
console.log('saved details')
await b.close()
