// End-to-end page load benchmark: navigation → domcontentloaded → load →
// slowest API groups. Measures the PERCEIVED fetch time the user sees.
// Usage: node scripts-perf/page_load_bench.mjs [origin]
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

const measure = async (label, url, settleMs) => {
  const navStart = Date.now()
  await page.goto(ORIGIN + url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, settleMs))
  const nav = await page.evaluate((origin) => {
    const out = { dcl: null, load: null, api: '' }
    const n = performance.getEntriesByType('navigation')[0]
    if (n) { out.dcl = n.domContentLoadedEventEnd; out.load = n.loadEventEnd }
    const res = performance.getEntriesByType('resource')
      .filter((r) => (r.initiatorType === 'fetch' || r.initiatorType === 'xmlhttprequest') && r.name.startsWith(origin))
    const byName = {}
    for (const r of res) {
      const k = r.name.replace(origin, '').split('?')[0].slice(0, 55)
      byName[k] = byName[k] || { n: 0, sum: 0, worst: 0 }
      byName[k].n++
      byName[k].sum += r.duration
      if (r.duration > byName[k].worst) byName[k].worst = r.duration
    }
    out.api = Object.entries(byName).sort((a, b) => b[1].worst - a[1].worst).slice(0, 6)
      .map(([k, v]) => `${k}×${v.n} ⌀${Math.round(v.sum / v.n)}ms ⌁${Math.round(v.worst)}ms`).join('  ')
    return out
  }, ORIGIN).catch(() => null)

  const dcl = nav?.dcl ?? Date.now() - navStart
  const load = nav?.load ?? dcl
  console.log(`${label.padEnd(24)} dcl:${(dcl / 1000).toFixed(2)}s  load:${(load / 1000).toFixed(2)}s`)
  if (nav?.api) console.log('    slowest: ' + nav.api.slice(0, 260))
}

const routes = [
  ['/', '/', 6000],
  ['/browse', '/browse', 6000],
  ['/anime/1 details', '/anime/1', 8000],
  ['/watch/1 player', '/watch/1?ep=1', 9000],
  ['/search?q=bleach', '/search?q=bleach', 6000],
  ['/schedule', '/schedule', 6000],
]
console.log('PAGE-LOAD BENCHMARK —', ORIGIN, '\n')
for (const [label, route, settle] of routes) {
  await measure(label, route, settle)
}
await browser.close()
console.log('\ndone')
