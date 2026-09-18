import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
await p.goto('http://127.0.0.1:5173/manga', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 2000))
// useevaluate to type — avoids Puppeteer locator issues
await p.evaluate(() => {
  const el = document.querySelector('input[placeholder*=\"Search manga\"]')
  if (el) { el.focus() }
})
await new Promise(r => setTimeout(r, 300))
await p.keyboard.type('Frieren', { delay: 80 })
await new Promise(r => setTimeout(r, 3500))
const dd = await p.evaluate(() => {
  const links = Array.from(document.querySelectorAll('a'))
  // the dropdown links have mangadex/atuso titles — grab those with small layout
  return links.map(a => (a.textContent||'').trim().slice(0, 100)).filter(t => t.length > 3 && t.length < 100).slice(0, 12)
})
console.log('dd', JSON.stringify(dd.slice(0, 10)))
await p.screenshot({ path: 'screenshots/en312-search-frieren.png', fullPage: false })
console.log('saved en312-search-frieren.png')
// click the manga browse search again but check API fallback
await p.goto('http://127.0.0.1:5173/manga', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))
const api2 = await p.evaluate(async () => {
  const r = await fetch('/api/atsu/search?q=Frieren&limit=3')
  const j = await r.json().catch(()=>null)
  return (j?.data?.results||[]).map(x=>x.title).slice(0,3)
})
console.log('atsu Frieren titles:', JSON.stringify(api2))
await b.close()
