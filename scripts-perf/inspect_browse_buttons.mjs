// Inspect Browse toolbar: list all buttons so the genre trigger is exact.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
await p.goto('http://localhost:5173/browse?filter=az&letter=B', { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 7000))

const btns = await p.evaluate(() =>
  [...document.querySelectorAll('button')].slice(0, 40).map((el, i) => ({
    i,
    text: el.textContent.trim().slice(0, 30),
    hasSvg: !!el.querySelector('svg'),
    cls: el.className.slice(0, 60),
  })),
)
console.log(JSON.stringify(btns, null, 1))
await b.close()
