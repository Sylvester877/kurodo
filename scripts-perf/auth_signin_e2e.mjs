// End-to-end: click the app's real sign-in button and capture the authorize
// URL it builds — response_type MUST be 'code' (confidential client), and
// the landing page must NOT be an AniList error.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(2500)

// Open the account menu / find a sign-in control. Fallback: build the URL
// directly through the app's own module by clicking any "Sign in" element.
const clicked = await page.evaluate(() => {
  const candidates = [...document.querySelectorAll('button, a')]
    .filter((el) => /sign in|login|anilist/i.test(el.textContent || '') && el.offsetParent !== null)
  if (!candidates.length) return null
  candidates[0].click()
  return candidates[0].textContent?.trim().slice(0, 40)
})
console.log('clicked:', clicked ?? 'NOTHING FOUND')

let landed = null
for (let i = 0; i < 15; i++) {
  await sleep(1000)
  const u = page.url()
  if (/anilist\.co/.test(u)) { landed = u; break }
}
if (!landed) {
  console.log('did not navigate to anilist.co — final URL:', page.url().slice(0, 120))
  await page.screenshot({ path: 'screenshots/auth-signin-click.png' })
  process.exit(2)
}
const rt = landed.match(/response_type=(\w+)/)?.[1]
const cid = landed.match(/client_id=(\d+)/)?.[1]
console.log('authorize URL landed:')
console.log('  response_type =', rt, rt === 'code' ? '✓ (code flow — correct for confidential)' : '✗ WRONG')
console.log('  client_id     =', cid)
console.log('  page title    =', (await page.title()).slice(0, 80))
await page.screenshot({ path: 'screenshots/auth-authorize-landing.png' })
console.log('shot: screenshots/auth-authorize-landing.png')

// go back to the app
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
process.exit(0)
