// Probe the live app's AniList auth state: token present? valid? whose account?
// Prints the token ONLY as length + prefix — never the value.
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

const state = await page.evaluate(() => {
  const raw = localStorage.getItem('kurodo-anilist-auth')
  const cid = localStorage.getItem('kurodo-anilist-client-id')
  const sec = localStorage.getItem('kurodo-anilist-client-secret')
  return {
    hasAuth: !!raw,
    authShape: raw ? Object.keys(JSON.parse(raw)) : null,
    expiresAt: raw ? JSON.parse(raw).expiresAt : null,
    tokenLen: raw ? (JSON.parse(raw).token || '').length : 0,
    clientId: cid,
    hasLocalSecret: !!sec,
    secLen: sec ? sec.length : 0,
  }
})
console.log('auth_state:', JSON.stringify(state))

if (!state.hasAuth || state.tokenLen === 0) {
  console.log('verdict: NO_TOKEN — user must sign in once interactively')
  browser.disconnect()
  process.exit(0)
}

// Validate the token against AniList (Viewer query) from Node — token stays in the page.
const token = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth')).token)
const r = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ query: 'query { Viewer { id name siteUrl } }' }),
})
const v = await r.json().catch(() => null)
console.log('viewer_status:', r.status, 'viewer:', JSON.stringify(v?.data?.Viewer ?? v?.errors?.[0]?.message ?? null))
console.log('verdict:', v?.data?.Viewer ? `TOKEN VALID — account: ${v.data.Viewer.name}` : 'TOKEN INVALID/EXPIRED')
browser.disconnect()
