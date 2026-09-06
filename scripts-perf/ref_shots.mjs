// Capture reference screenshots of anidap / anikage / aniclover for UI study.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const OUT = new URL('../screenshots/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const targets = [
  { name: 'ref-anidap', url: 'https://anidap.lol/home' },
  { name: 'ref-anikage', url: 'https://anikage.cc/' },
  { name: 'ref-aniclover', url: 'https://aniclover.cc/' },
]

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 1440, height: 900 },
})

for (const t of targets) {
  try {
    const p = await b.newPage()
    await p.goto(t.url, { waitUntil: 'networkidle2', timeout: 45000 })
    await new Promise((r) => setTimeout(r, 4000)) // let hero sliders settle
    await p.screenshot({ path: `${OUT}${t.name}.png` })
    console.log(`OK ${t.name}`)
    await p.close()
  } catch (e) {
    console.log(`FAIL ${t.name}: ${e.message?.slice(0, 120)}`)
  }
}
await b.close()
