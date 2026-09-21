// Trace the flush path with full console capture: seed queue while "signed
// out", restore auth, reload, capture every [sync] line.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(4000)

const logs = []
page.on('console', (m) => { try { logs.push(m.text()) } catch {} })

// sign out + seed
await page.evaluate(() => {
  localStorage.setItem('kurodo-anilist-auth-backup', localStorage.getItem('kurodo-anilist-auth'))
  localStorage.removeItem('kurodo-anilist-auth')
  localStorage.setItem('kurodo-pending-anilist-progress', JSON.stringify({ '16498': 3 }))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(5000)
logs.length = 0

// sign back in
await page.evaluate(() => {
  localStorage.setItem('kurodo-anilist-auth', localStorage.getItem('kurodo-anilist-auth-backup'))
  localStorage.removeItem('kurodo-anilist-auth-backup')
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(15000)

console.log('--- [sync]/auth console lines ---')
for (const l of logs.filter((l) => /\[sync\]|anilist|flush|backfill|queued/i.test(l))) console.log(l)
console.log('queue now:', await page.evaluate(() => localStorage.getItem('kurodo-pending-anilist-progress')))
console.log('auth now:', await page.evaluate(() => !!localStorage.getItem('kurodo-anilist-auth')))
process.exit(0)
