// Diagnose why /watch/113415 (JJK) never fetches servers.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5173'

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000 })
const failures = []
page.on('response', (r) => {
  if (r.status() >= 400) failures.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 100)}`)
})
page.on('requestfailed', (r) => {
  failures.push(`FAILED ${r.failure()?.errorText} ${r.url().replace(BASE, '').slice(0, 100)}`)
})
// seed localStorage past the setup wizard
const p2 = await browser.newPage()
await p2.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 1500))
await p2.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /skip setup/i.test(b.textContent))
  btn?.click()
})
await new Promise((r) => setTimeout(r, 800))
await p2.close()

await page.goto(`${BASE}/watch/113415`, { waitUntil: 'domcontentloaded' })
for (const mark of [10, 25, 45]) {
  await new Promise((r) => setTimeout(r, (mark - (mark === 10 ? 0 : mark === 25 ? 10 : 25)) * 1000))
  const state = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body
    const text = main.innerText.replace(/\s+/g, ' ').slice(0, 400)
    const hasVideo = !!document.querySelector('video')
    return { text, hasVideo }
  })
  console.log(`\n─── t=${mark}s video=${state.hasVideo}`)
  console.log(state.text)
}
console.log('\n─── HTTP >=400 / failed:')
failures.forEach((f) => console.log(' ', f))
await browser.close()
