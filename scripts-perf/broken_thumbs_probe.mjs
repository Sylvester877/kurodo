// Probe broken anime thumbnails across pages: home, browse, search.
// For every <img>, check naturalWidth — 0 = broken/never loaded.
// Also catches images stuck at opacity-0 (ImageWithBlur never fired onLoad).
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5173'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })

// Pre-dismiss first-run SetupWizard (fresh profile → empty localStorage)
await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.evaluate(() => {
  try {
    localStorage.setItem('kurodo_setup_done', '1')
    localStorage.setItem('kurodo-setup-complete', '1')
    localStorage.setItem('setup_wizard_done', '1')
  } catch {}
})

const scan = async (label) => {
  const report = await p.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 4000)) // let lazy images settle
    const imgs = [...document.querySelectorAll('img')]
    const broken = []
    const invisible = []
    for (const img of imgs) {
      const src = img.currentSrc || img.src || ''
      if (!src || src.startsWith('data:')) continue
      if (img.complete && img.naturalWidth === 0) {
        broken.push(src.slice(0, 120))
      } else if (getComputedStyle(img).opacity === '0' && img.naturalWidth > 0) {
        invisible.push(src.slice(0, 120))
      } else if (!img.complete) {
        invisible.push('(still loading) ' + src.slice(0, 100))
      }
    }
    const total = imgs.filter((i) => (i.currentSrc || i.src || '').startsWith('http')).length
    return { total, broken, invisible: invisible.slice(0, 10) }
  })
  console.log(`\n=== ${label} — ${report.total} remote imgs ===`)
  console.log(`broken (naturalWidth=0): ${report.broken.length}`)
  for (const s of report.broken.slice(0, 8)) console.log('  BROKEN:', s)
  console.log(`invisible/stuck: ${report.invisible.length}`)
  for (const s of report.invisible.slice(0, 5)) console.log('  STUCK:', s)
  return report
}

await scan('home')
await p.goto(BASE + '/browse', { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
await p.evaluate(() => window.scrollTo(0, 1500))
await scan('browse (scrolled)')
await p.goto(BASE + '/search?q=one%20piece', { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
await scan('search one piece')

await b.close()
