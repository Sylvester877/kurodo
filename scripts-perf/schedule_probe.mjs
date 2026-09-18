// Focused /schedule probe: reports how long the page takes to show episodes,
// which upstream each number came from, and any FAILED requests (CORS, 429,
// timeouts) so we can tell "slow" apart from "broken".
// Usage: node scripts-perf/schedule_probe.mjs [origin] [label]
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const BASE = process.argv[2] || 'http://127.0.0.1:5173'
const LABEL = process.argv[3] || 'now'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})

const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
await p.evaluateOnNewDocument(() => {
  try { localStorage.setItem('kurodo-setup-done', '1') } catch { /* ignore */ }
})

const events = []
p.on('requestfailed', (r) => events.push(`FAIL ${r.failure()?.errorText} ${r.url().slice(0, 110)}`))
p.on('response', (r) => {
  const u = r.url()
  if (/anilist|jikan|kitsu/i.test(u)) events.push(`RESP ${r.status()} ${u.slice(0, 110)}`)
})
p.on('console', (m) => {
  const t = m.text()
  if (/schedule|anilist|rate|429|cors|fallback/i.test(t)) events.push(`LOG ${t.slice(0, 160)}`)
})

const t0 = Date.now()
await p.goto(`${BASE}/schedule`, { waitUntil: 'domcontentloaded', timeout: 90000 })

let firstCards = null
for (;;) {
  const st = await p.evaluate(() => {
    const cards = document.querySelectorAll('a[href^="/anime/"]').length
    const busy = !!document.querySelector('.animate-pulse, .shimmer')
    const body = document.body.innerText || ''
    return { cards, busy, outage: /Couldn'?t load the schedule|Unavailable/i.test(body), body: body.slice(0, 160) }
  })
  if (st.cards > 0 && !firstCards) firstCards = Date.now() - t0
  if ((st.cards > 0 || st.outage) && !st.busy) break
  if (Date.now() - t0 > 60000) break
  await sleep(200)
}
const wall = Date.now() - t0
const st = await p.evaluate(() => ({
  cards: document.querySelectorAll('a[href^="/anime/"]').length,
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
}))
console.log(`\n── /schedule (${LABEL}) ──`)
console.log(`   wall ${(wall / 1000).toFixed(2)}s   first cards ${firstCards ? (firstCards / 1000).toFixed(2) + 's' : 'never'}   cards ${st.cards}`)
console.log(`   page: ${st.text}`)
console.log('   network/console:')
for (const e of events.slice(-40)) console.log('     ' + e)

await p.screenshot({ path: path.join(OUT, `perf-${LABEL}-schedule-focus.png`) })
console.log(`   shot: perf-${LABEL}-schedule-focus.png`)
await b.close()
