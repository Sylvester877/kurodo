// Probe: exact selectors/paths of elements with computed font-size < 10px
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
await p.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const arg = process.argv[2] || 'watch/57555'
await p.goto('http://localhost:5173/' + arg.replace(/^\/+/, ''), {
  waitUntil: 'networkidle2',
  timeout: 45000,
})
await new Promise((r) => setTimeout(r, 2500))
const res = await p.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue
    const t = (el.textContent || '').trim()
    if (!t) continue
    const f = parseFloat(getComputedStyle(el).fontSize)
    if (f < 10) {
      const cls = String(el.className).slice(0, 100)
      out.push(`${f}px "${t.slice(0, 26)}" cls="${cls}"`)
      if (out.length >= 12) break
    }
  }
  return out
})
res.forEach((s) => console.log(s))
await b.close()
