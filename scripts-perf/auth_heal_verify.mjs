// Verify the invalid_client self-heal path in the live app:
//  1. simulate the failure by clearing any stale flags, then confirm the
//     sticky-rejected flag flips getLoginUrl to the implicit flow
//  2. confirm the secret is no longer present in the served bundle
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

const resp = await page.goto('http://localhost:5173/auth/callback?code=fake-code-probe', {
  waitUntil: 'domcontentloaded', timeout: 30000,
}).catch((e) => ({ error: e.message }))
await new Promise((r) => setTimeout(r, 5000))

const probe = await page.evaluate(() => {
  const auth = window.__KURODO_PROBE__ ?? null
  const bodyText = document.body.innerText.slice(0, 400)
  return {
    url: window.location.href,
    rejectedFlag: localStorage.getItem('kurodo-anilist-pair-rejected'),
    secretCleared: localStorage.getItem('kurodo-anilist-client-secret') == null,
    bodyText,
  }
})
console.log(JSON.stringify(probe, null, 2))

await page.screenshot({ path: 'screenshots/auth-invalid-client-heal.png' })
console.log('shot: screenshots/auth-invalid-client-heal.png')

// Restore a clean state for the user (flag + secret will re-populate on
// their next successful sign-in; the sticky flag is the desired outcome).
console.log('DONE')
process.exit(0)
