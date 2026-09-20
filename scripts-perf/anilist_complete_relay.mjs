// Complete the external-browser OAuth handoff WITHOUT the app UI:
//   1. Generate a state, start relaying on the user's authorize click.
//   2. Poll GET /api/anilist/relay-token?state=… until the external tab
//      POSTs the token (AuthCallback relays when it detects a browser).
//   3. Persist it into the app exactly like setAuthFromToken does
//      (localStorage kurodo-anilist-auth + viewer fetch), then reload the
//      window so the whole app picks the session up.
// Usage: node scripts-perf/anilist_complete_relay.mjs <state>
import puppeteer from 'puppeteer-core'

const STATE = process.argv[2] || `kurodo-test-${Math.random().toString(36).slice(2, 10)}`
console.log('STATE:', STATE)
console.log('AUTH_URL:', `https://anilist.co/api/v2/oauth/authorize?client_id=51565&redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}&response_type=code&state=${STATE}`)

const ORIGIN = 'http://127.0.0.1:5173'
const deadline = Date.now() + 4 * 60 * 1000
let token = null, expiresIn = null
process.stdout.write('polling relay')
while (Date.now() < deadline && !token) {
  try {
    const r = await fetch(`${ORIGIN}/api/anilist/relay-token?state=${encodeURIComponent(STATE)}`)
    const j = await r.json()
    if (j?.ok && j?.data?.token) { token = j.data.token; expiresIn = j.data.expiresIn }
  } catch { /* backend busy */ }
  if (!token) { process.stdout.write('.'); await new Promise((r) => setTimeout(r, 1500)) }
}
console.log('')
if (!token) { console.error('TIMEOUT — no token relayed within 4 min'); process.exit(1) }
console.log('token_relayed: YES (len', token.length + ')')

// Validate the token's account BEFORE touching the app.
const v = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ query: 'query { Viewer { id name } }' }),
})
const vj = await v.json().catch(() => null)
const who = vj?.data?.Viewer?.name ?? 'UNKNOWN'
console.log('token_account:', who)
if (who !== 'Gre0dy') {
  console.error(`ABORT — token is for "${who}", expected Gre0dy. NOT saving anything.`)
  process.exit(1)
}

// Persist into the live app (same shape useAuthStore.setAuthFromToken writes).
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }
const saved = await page.evaluate(async (token, expiresIn) => {
  try {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: 'query { Viewer { id name avatar { large } bannerImage } }' }),
    })
    const j = await r.json()
    const u = j?.data?.Viewer
    if (!u) return 'VIEWER_FAILED'
    localStorage.setItem('kurodo-anilist-auth', JSON.stringify({
      token, expiresAt: Date.now() + expiresIn * 1000,
      user: { id: u.id, name: u.name, avatar: u.avatar?.large ?? null, bannerImage: u.bannerImage ?? null },
    }))
    return 'SAVED'
  } catch (e) { return 'ERR:' + e.message }
}, token, expiresIn ?? 31536000)
console.log('persist:', saved)
if (saved === 'SAVED') { await page.reload({ waitUntil: 'domcontentloaded' }); console.log('app_reloaded') }
browser.disconnect()
console.log('DONE — signed in as', who)
