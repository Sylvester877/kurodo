import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
async function cap(url, out) {
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise(r => setTimeout(r, 4000))
  await p.screenshot({ path: `screenshots/${out}`, fullPage: false })
  console.log('saved', out)
  const titles = await p.$$eval('a', els => els.slice(0, 20).map(e => (e.textContent||'').trim().slice(0, 50)).filter(Boolean).slice(0, 8))
  console.log('titles', JSON.stringify(titles))
}
await cap('http://127.0.0.1:5173/manga', 'en312-manga-browse.png')
await cap('http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13', 'en312-reader-atsu.png')
await b.close()
