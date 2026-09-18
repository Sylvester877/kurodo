// Verify the Schedule page no longer silently lies during the AniList
// outage: it should show an outage message + Retry instead of claiming
// "No episodes scheduled" for every day.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,1000'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 1000 })
const errs = []
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })

await p.goto('http://127.0.0.1:5173/schedule', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise((r) => setTimeout(r, 9000))

const out = await p.evaluate(() => {
  const text = document.body.innerText || ''
  return {
    hasOutageMsg: text.includes("Couldn't load the schedule"),
    hasOutageSub: text.includes('having an outage'),
    hasRetry: text.includes('Retry'),
    misleadingEmpty: (text.match(/No episodes scheduled/g) || []).length,
    perDayUnavailable: (text.match(/Unavailable/g) || []).length,
    perDayNoEpisodes: (text.match(/No episodes/g) || []).length,
  }
})
console.log(JSON.stringify(out, null, 1))
console.log('console errors:', errs.slice(0, 6))
await p.screenshot({ path: 'screenshots/schedule-outage-state.png' })
await b.close()
