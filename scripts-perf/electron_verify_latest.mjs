// Verify the LIVE Electron window carries the latest ordering changes.
//
// Connects to the running app over CDP (launch with
//   npx electron --remote-debugging-port=9222 .
// — the switch must come BEFORE the app path or Chromium never sees it),
// walks to a Watch page, reads the REAL rendered server-chip order out of the
// DOM and screenshots it. Prints the chip order so the capability-first
// ranking can be confirmed without trusting the bundle.
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const WATCH_PATH = process.env.WATCH_PATH || '/watch/21?ep=1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null,
})
const pages = await browser.pages()
const page = pages.find((p) => p.url().includes('5173')) || pages[0]
console.log('attached to:', page.url())

await page.screenshot({ path: path.join(OUT, 'electron-latest-home.png') })
console.log('shot  screenshots/electron-latest-home.png')

await page.goto(`http://localhost:5173${WATCH_PATH}`, { waitUntil: 'domcontentloaded' })
// The picker only appears after slug + provider resolution (chad scrape).
for (let i = 0; i < 20; i++) {
  await sleep(2500)
  const ready = await page.evaluate(() =>
    !!document.querySelector('[data-server-chip], .server-chip') ||
    /server/i.test(document.body.innerText || ''),
  )
  if (ready && i >= 4) break
}
await sleep(6000)

// Read the rendered chip order. The picker renders buttons with the server
// label; grab every button whose text matches a known server name so the
// order is the REAL DOM order, not an assumption about class names.
const report = await page.evaluate(() => {
  const KNOWN = ['loli', 'yuki', 'neko', 'sora', 'miku', 'mimi', 'kiwi', 'beep', 'nuri', 'kami', 'koto', 'mochi', 'shiro', 'wave']
  // Each chip is a <button> whose FIRST span is the server label ("Loli"),
  // followed by type/badge spans. Matching the whole textContent misses them
  // (it concatenates to "LoliSUBUNVERIFIED").
  const firstSpan = (el) => (el.querySelector('span')?.textContent || '').trim().toLowerCase()
  const out = []
  for (const el of document.querySelectorAll('button')) {
    const t = firstSpan(el)
    if (!t) continue
    const hit = KNOWN.find((k) => t === k)
    if (hit) {
      out.push({
        name: hit,
        disabled: el.disabled === true,
        badges: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        active: /active/.test(el.className) || el.getAttribute('aria-current') === 'true',
      })
    }
  }
  return {
    url: location.href,
    order: out.map((o) => o.name),
    active: out.filter((o) => o.active).map((o) => o.name),
    disabled: out.filter((o) => o.disabled).map((o) => o.name),
    badges: out.map((o) => `${o.name}: ${o.badges}`),
    bodyHasPicker: /servers|server/i.test(document.body.innerText || ''),
  }
})

console.log('\npage:', report.url)
console.log('server chips rendered in the live window (DOM order):')
console.log('  ' + (report.order.join(' > ') || '(none found)'))
console.log('  selected/default chip:', report.active.join(', ') || '(none flagged active)')
console.log('  disabled chips:', report.disabled.length === 0 ? 'none (nothing hidden or blocked)' : report.disabled.join(', '))
if (report.badges.length) {
  console.log('  chip text as rendered:')
  for (const b of report.badges.slice(0, 14)) console.log('    · ' + b)
}

await page.screenshot({ path: path.join(OUT, 'electron-latest-watch.png') })
console.log('\nshot  screenshots/electron-latest-watch.png')

browser.disconnect()
