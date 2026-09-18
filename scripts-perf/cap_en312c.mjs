import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
// force-reload the browse page and dump the first few card titles
await p.goto('http://127.0.0.1:5173/manga', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 5000))
const api = await p.evaluate(async () => {
  const r = await fetch('/api/manga/search?q=Kusuriya%20no%20Hitorigoto&limit=2')
  const j = await r.json().catch(()=>null)
  return (j?.data?.results||[]).map(x=>x.title).slice(0,2)
})
console.log('api mangadex titles:', JSON.stringify(api))
const cards = await p.$$eval('.grid a', els => els.slice(0, 8).map(e => (e.textContent||'').trim().replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean))
console.log('card captions:', JSON.stringify(cards.slice(0, 6)))
await p.screenshot({ path: 'screenshots/en312-verify-browse.png', fullPage: false })
console.log('saved en312-verify-browse.png')
// details page for Apothecary
await p.goto('http://127.0.0.1:5173/manga/search', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{})
await new Promise(r => setTimeout(r, 1000))
// type in search and check dropdown shows English
await p.goto('http://127.0.0.1:5173/manga', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 2000))
const searchInput = await p.$('input[placeholder*=\"Search manga\"]')
if (searchInput) {
  await searchInput.click()
  await searchInput.type('Frieren', { delay: 60 })
  await new Promise(r => setTimeout(r, 2500))
  const ddTitles = await p.$$eval('a', els => els.map(e => (e.textContent||'').trim().slice(0, 80)).filter(Boolean).slice(0, 10))
  console.log('dropdown:', JSON.stringify(ddTitles.slice(0, 8)))
  await p.screenshot({ path: 'screenshots/en312-search-dropdown.png', fullPage: false })
  console.log('saved en312-search-dropdown.png')
}
await b.close()
