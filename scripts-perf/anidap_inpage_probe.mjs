// Fetch /api/anime/sources from INSIDE the real anidap.lol page (same-origin,
// real cookies + CF clearance) — the faithful reproduction of what the site does.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
page.setDefaultNavigationTimeout(45000)
page.setDefaultTimeout(45000)

try {
  await page.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'domcontentloaded', timeout: 45000 })
} catch (e) {
  console.log('nav warn:', e.message)
}
await new Promise((r) => setTimeout(r, 6000))

const slug = process.argv[2] || 'fullmetal-alchemist-brotherhood'
const ep = process.argv[3] || '1'
const host = process.argv[4] || 'yuki'
const type = process.argv[5] || 'sub'

const out = await page.evaluate(async (slug, ep, host, type) => {
  try {
    const res = await fetch(`/api/anime/sources?id=${encodeURIComponent(slug)}&ep=${ep}&host=${host}&type=${type}`, { credentials: 'include' })
    const text = await res.text()
    return { status: res.status, body: text.slice(0, 4000) }
  } catch (e) {
    return { status: 0, body: 'THREW: ' + e.message }
  }
}, slug, ep, host, type)

console.log(`status: ${out.status}`)
console.log(`body: ${out.body.slice(0, 1200)}`)
fs.writeFileSync('C:/Users/sylvester/Downloads/kurodo/Bleach edit/repo/scripts-perf/inpage_sources.json', out.body)
await browser.close()
