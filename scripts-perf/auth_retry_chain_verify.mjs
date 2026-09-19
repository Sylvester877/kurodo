// Verify the revised heal: fake code → invalid_client (or invalid_request)
// → one silent retry that must go to authorize?response_type=code (backend
// exchange), NOT implicit (response_type=token).
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

// Clean slate: clear any stale flags/secrets from prior experiments.
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(1500)
await page.evaluate(() => {
  localStorage.removeItem('kurodo-anilist-pair-rejected')
  sessionStorage.clear()
})
console.log('state cleared')

// Feed a fake code — same session, one retry expected.
await page.goto('http://localhost:5173/auth/callback?code=a1b2c3d4e5f60718293a4b5c6d7e8f90', {
  waitUntil: 'domcontentloaded', timeout: 30000,
})
// Wait through the exchange + heal redirect (~0.9s delay) to the authorize page
let landedAuthorize = false
for (let i = 0; i < 20; i++) {
  await sleep(1000)
  const u = page.url()
  if (/anilist\.co\/api\/v2\/oauth\/authorize/.test(u)) {
    landedAuthorize = true
    console.log('retried to:', u.slice(0, 160))
    break
  }
  if (i === 19) console.log('final URL:', u.slice(0, 160))
}
const flow = page.url().match(/response_type=(\w+)/)?.[1] ?? null
console.log('response_type:', flow, '| verdict:', landedAuthorize && flow === 'code' ? 'PASS (code-flow retry)' : flow === 'token' ? 'FAIL (still implicit)' : 'NO-REDIRECT (check exchange result)')

const state = await page.evaluate(() => ({
  secretCleared: localStorage.getItem('kurodo-anilist-client-secret') == null,
  retryFlag: sessionStorage.getItem('kurodo-anilist-implicit-retry') != null,
}))
console.log(JSON.stringify(state))

await page.screenshot({ path: 'screenshots/auth-retry-code-flow.png' })
console.log('shot: screenshots/auth-retry-code-flow.png')

// Bring the app view back
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
process.exit(0)
