// Verify the /login gate exactly as the external browser sees it:
// load /login?state=...&cid=43597 in the Electron window (a fresh context
// equivalent — same renderer, no Electron localStorage seeding for the
// login page logic beyond what the page itself reads), wait for the
// auto-start redirect, and check response_type.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

const state = `web-${Date.now().toString(36)}-probe0001`
await page.goto(`http://localhost:5173/login?state=${encodeURIComponent(state)}&cid=43597`, {
  waitUntil: 'domcontentloaded', timeout: 30000,
})
console.log('login gate loaded, waiting for auto-start (1.4s timer + health fetch)…')

let landed = null
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  const u = page.url()
  if (/anilist\.co/.test(u)) { landed = u; break }
}
if (!landed) {
  console.log('no redirect. URL:', page.url().slice(0, 140))
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 300))
  console.log('page text:', txt.replace(/\n+/g, ' | ').slice(0, 280))
  await page.screenshot({ path: 'screenshots/auth-login-gate.png' })
  process.exit(2)
}
const rt = landed.match(/response_type=(\w+)/)?.[1]
console.log('authorize redirect response_type =', rt, rt === 'code' ? '✓ CODE (correct)' : '✗ ' + rt + ' (implicit — the bug)')
await page.screenshot({ path: 'screenshots/auth-login-gate-redirect.png' })
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
process.exit(0)
