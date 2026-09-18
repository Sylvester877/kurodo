// Dump Schedule page text + console errors to see the actual state.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
const errors = []
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 150)) })
await p.setViewport({ width: 1440, height: 900 })
await p.goto('http://localhost:5173/schedule', { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 30_000))

const state = await p.evaluate(() => ({
  text: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 1200),
}))
console.log(state.text)
console.log('--- console errors/warnings ---')
errors.slice(-12).forEach((e) => console.log(e))
await b.close()
