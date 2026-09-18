// Error sweep v3 — runs against ANY origin via headless Chrome CDP.
// Usage: node scripts-perf/error_sweep_fresh.mjs [origin]
// Defaults origin to http://127.0.0.1:5199 (fresh-code server).
import WebSocket from 'ws'
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const ORIGIN = process.argv[2] || 'http://127.0.0.1:5199'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })

const errors = []
const failed = []
const warnings = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 220))
  else if (m.type() === 'warning') warnings.push(m.text().slice(0, 140))
})
page.on('requestfailed', (r) => {
  const f = r.failure()
  failed.push({ url: r.url().slice(0, 90), error: f?.errorText || '', blocked: r.isNavigationRequest() ? 'nav' : '' })
})
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 220)))

const routes = ['/', '/browse', '/anime/5114', '/search', '/schedule', '/seasonal', '/settings', '/watchlist', '/manga']
for (const r of routes) {
  errors.length = 0
  failed.length = 0
  warnings.length = 0
  await page.goto(ORIGIN + r, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
  await new Promise((res) => setTimeout(res, r.includes('/watch') ? 9000 : 6000))
  const uniqFails = [...new Map(failed.map((x) => [x.url + x.error, x])).values()]
  console.log(`\n=== ${r} === errors:${errors.length} failed:${uniqFails.length} warn:${warnings.length}`)
  for (const e of [...new Set(errors)].slice(0, 5)) console.log('  ERR  ', e.slice(0, 150))
  for (const f of uniqFails.slice(0, 6)) console.log('  FAIL ', (f.error || '?').slice(0, 60), '|', f.url)
  for (const w of [...new Set(warnings)].slice(0, 3)) console.log('  WARN ', w.slice(0, 110))
}
await browser.close()
console.log('\nsweep done')
