// Live verify: mark-watched button removed + Top10 tabs + Fresh-off-the-press tabs.
// Navigates the real Electron window via CDP, screenshots into screenshots/.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = (n) => `screenshots/copy-sites-${n}.png`

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

// 1) Watch page — the manual mark-watched button must be GONE.
await page.goto('http://127.0.0.1:5173/watch/21?ep=1', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(7000)
const markBtn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('button')]
  return els.filter((b) => /mark (as )?watched|mark as unwatched/i.test(b.textContent || b.getAttribute('aria-label') || '')).length
})
console.log('mark_watched_buttons:', markBtn, markBtn === 0 ? '✓ REMOVED' : '✗ STILL PRESENT')
await page.screenshot({ path: shot('1-watch-no-mark-btn') })

// 2) Home — Top 10 Day/Week/Month tabs.
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(5000)
// Scroll to the Top 10 section and click the Day tab — poll until mounted.
let top10 = null
for (let i = 0; i < 20 && !top10; i++) {
  top10 = await page.evaluate(() => {
    const headings = [...document.querySelectorAll('h2')]
    const h = headings.find((x) => /top 10/i.test(x.textContent || ''))
    if (!h) return null
    h.closest('section')?.scrollIntoView({ block: 'start' })
    return true
  })
  if (!top10) {
    // Nudge scrolling so LazyMount sections mount.
    await page.evaluate(() => window.scrollBy(0, 900))
    await sleep(1500)
  }
}
await sleep(2500)
const tabs = await page.$$eval('[role="tablist"] button', (bs) => bs.map((b) => b.textContent?.trim()))
console.log('top10_tabs:', JSON.stringify(tabs))
const dayBtn = await page.evaluateHandle(() => {
  const lists = [...document.querySelectorAll('[role="tablist"]')]
  const tl = lists.find((l) => l.querySelector('button')?.textContent?.trim() === 'Day')
  if (!tl) return null
  return [...tl.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Day') ?? null
})
if (dayBtn && dayBtn.asElement()) { await dayBtn.asElement().click(); await sleep(2000) }
const top10Shot = shot('2-top10-day-tab')
await page.screenshot({ path: top10Shot })
// First ranked title after switching to Day (trending).
const dayFirst = await page.evaluate(() => {
  const headings = [...document.querySelectorAll('h2')]
  const h = headings.find((x) => /top 10/i.test(x.textContent || ''))
  const sec = h?.closest('section')
  return sec?.querySelector('a h3')?.textContent?.trim() ?? null
})
console.log('top10_day_first:', dayFirst)

// 3) Fresh off the press — New Release / Newly Added / Just Completed.
await page.evaluate(() => {
  const headings = [...document.querySelectorAll('h2')]
  const h = headings.find((x) => /fresh off the press/i.test(x.textContent || ''))
  h?.closest('section')?.scrollIntoView({ block: 'start' })
})
await sleep(3000)
const freshTabs = await page.evaluate(() => {
  const headings = [...document.querySelectorAll('h2')]
  const h = headings.find((x) => /fresh off the press/i.test(x.textContent || ''))
  const sec = h?.closest('section')
  if (!sec) return null
  return [...sec.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean)
})
console.log('fresh_tabs:', JSON.stringify(freshTabs))
// Click "Just Completed" and count rendered cards.
const jcBtn = await page.evaluateHandle(() => {
  const headings = [...document.querySelectorAll('h2')]
  const h = headings.find((x) => /fresh off the press/i.test(x.textContent || ''))
  const sec = h?.closest('section')
  return [...(sec?.querySelectorAll('button') ?? [])].find((b) => /just completed/i.test(b.textContent || ''))
})
if (jcBtn && jcBtn.asElement()) { await jcBtn.asElement().click(); await sleep(3000) }
const freshCount = await page.evaluate(() => {
  const headings = [...document.querySelectorAll('h2')]
  const h = headings.find((x) => /fresh off the press/i.test(x.textContent || ''))
  const sec = h?.closest('section')
  return sec?.querySelectorAll('a[href^="/anime/"]').length ?? 0
})
console.log('fresh_just_completed_cards:', freshCount, freshCount >= 5 ? '✓' : '✗')
await page.screenshot({ path: shot('3-fresh-just-completed') })

console.log('VERDICT:', markBtn === 0 && tabs.includes('Day') && freshCount >= 5 ? 'PASS' : 'CHECK')
browser.disconnect()
