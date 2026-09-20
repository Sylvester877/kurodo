// In-page verification of the login gate flow decision — bypasses the
// Electron external-open indirection (which can't be observed via CDP).
// Simulates the external browser tab: /login?cid= with NO local secret,
// then calls the app's own getLoginUrl through a dynamic module import.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

// Fresh tab context: strip ALL local auth state = exactly what the external
// browser sees (no Electron localStorage, no disk creds).
await page.goto('http://localhost:5173/login?cid=43597', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(1000)
await page.evaluate(() => {
  localStorage.removeItem('kurodo-anilist-client-secret')
  localStorage.removeItem('kurodo-anilist-client-id')
  sessionStorage.clear()
})
try {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
} catch { /* reload can detach the frame in Electron — page is fresh anyway */ }
await sleep(3500) // health fetch + module init

const decision = await page.evaluate(async () => {
  // Import the app's own module through Vite's dev/bundled graph.
  const mod = await import('/src/api/anilistAuth.ts').catch(() => null)
    || await import('/assets/' + (Array.from(document.scripts).map(s => s.src).find(s => s.includes('assets/index')) || '').split('/').pop()).catch(() => null)
  if (!mod) return { error: 'module import unavailable in prod bundle' }
  await mod.refreshBackendSecretFlag(true)
  const url = mod.getLoginUrl({ flow: 'auto', state: 'probe-state-0001' })
  return {
    url,
    response_type: url?.match(/response_type=(\w+)/)?.[1] ?? null,
    backendFlag: mod.backendHasSecret(),
  }
})
console.log(JSON.stringify(decision, null, 2))
const rt = decision.response_type
console.log('\nVERDICT:', rt === 'code' ? '✓ PASS — secret-less tab now builds CODE flow (backend flag)' : rt === 'token' ? '✗ FAIL — still implicit' : '? ' + String(decision.error || 'n/a'))

process.exit(0)
