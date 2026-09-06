// Render anikage.cc home and dump the page's section structure + hero layout
// so we can mirror it precisely in Kurodo's Hero.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,1200'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 })
const errors = []
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)) })
p.on('pageerror', (e) => errors.push('PAGEERR ' + String(e).slice(0, 120)))
await p.goto('https://anikage.cc/', { waitUntil: 'networkidle2', timeout: 60000 })
await new Promise((r) => setTimeout(r, 6000))

const dump = await p.evaluate(() => {
  // All section-like headings in document order with their horizontal position
  const heads = [...document.querySelectorAll('h1,h2,h3,[class*="heading"],[class*="title"]')]
    .filter((el) => {
      const t = el.textContent.trim()
      const r = el.getBoundingClientRect()
      return t.length > 2 && t.length < 60 && r.width > 0 && el.offsetParent
    })
    .map((el, i) => {
      const r = el.getBoundingClientRect()
      return {
        i,
        tag: el.tagName.toLowerCase(),
        cls: (el.className + '').slice(0, 70),
        text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60),
        x: Math.round(r.x), y: Math.round(r.y + window.scrollY), w: Math.round(r.width),
      }
    })
  // Distinct full-width sections via heading y-positions (they mark section starts)
  const bodyTop = document.body.scrollHeight
  return { heads, bodyTop, url: location.href, title: document.title }
})
console.log('PAGE:', dump.url)
console.log('body height:', dump.bodyTop)
for (const h of dump.heads.slice(0, 45)) {
  console.log(`  y=${String(h.y).padStart(5)} x=${String(h.x).padStart(4)} w=${String(h.w).padStart(4)} <${h.tag}> ${h.text}`)
}
console.log('console errors:', errors.length, errors.slice(0, 3))
await p.screenshot({ path: 'screenshots/anikage-study-home.png' })
await b.close()
