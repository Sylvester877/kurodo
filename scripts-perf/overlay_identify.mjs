// Identify the z-[80] overlay covering the page.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 900 })
await p.goto('http://localhost:5173/search?q=naruto', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 4000))

const info = await p.evaluate(() => {
  // Find all z-[80] fixed overlays (arbitrary-value class needs manual scan)
  const hits = []
  for (const el of document.querySelectorAll('div.fixed.inset-0')) {
    const cs = getComputedStyle(el)
    if (cs.zIndex !== '80') continue
    hits.push({
      text: el.innerText?.slice(0, 400) || '(no text)',
      childTags: [...el.children].map((c) => c.tagName + '.' + (c.className?.toString?.() || '').slice(0, 40)).slice(0, 6),
      html: el.outerHTML.slice(0, 300),
    })
  }
  return hits
})
console.log(JSON.stringify(info, null, 2))
await b.close()
