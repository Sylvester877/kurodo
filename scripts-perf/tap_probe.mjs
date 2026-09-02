// Probe: interactive elements smaller than 36px on a page (tap-target audit)
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
await p.setViewport({ width: 375, height: 812, isMobile: true, hasTouch: true })
const arg = process.argv[2] || 'seasonal'
await p.goto('http://localhost:5173/' + arg.replace(/^\/+/, ''), {
  waitUntil: 'networkidle2',
  timeout: 45000,
})
await new Promise((r) => setTimeout(r, 2500))
const res = await p.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('button, a')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if ((r.width < 36 || r.height < 36) && r.width > 4) {
      out.push(
        `${el.tagName} [${Math.round(r.width)}x${Math.round(r.height)}] cls="${String(el.className).slice(0, 90)}"`,
      )
    }
  }
  return out.slice(0, 10)
})
res.forEach((s) => console.log(s))
await b.close()
