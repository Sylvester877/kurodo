// Round-1 probe: which elements produce the distinct border radii on home?
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 2000))
const res = await p.evaluate(() => {
  const seen = {}
  for (const el of document.querySelectorAll('body *')) {
    const r = getComputedStyle(el).borderRadius
    if (!r || r === '0px') continue
    const rr = parseFloat(r)
    if (rr > 100) continue // pills/circles — fine
    const rect = el.getBoundingClientRect()
    if (rect.width < 5) continue
    const key = r === "14px" ? r : (rr > 8 && rr < 20 ? "12/16 bucket" : r)
    if (!seen[key]) seen[key] = []
    if (seen[key].length < 3) {
      seen[key].push(el.tagName + '.' + String(el.className).slice(0, 80) + ` [${Math.round(rect.width)}x${Math.round(rect.height)}]`)
    }
  }
  return seen
})
console.log(JSON.stringify(res, null, 1))
await b.close()
