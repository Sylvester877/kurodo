// Re-run the relay handoff: polls the relay for a fresh Gre0dy token and
// persists it into the app (same as anilist_complete_relay but Gre0dy-guarded
// and quieter). Usage: node burner_reauth.mjs <state>
import puppeteer from 'puppeteer-core'

const STATE = process.argv[2] || `reauth-${Math.random().toString(36).slice(2, 8)}`
const ORIGIN = 'http://localhost:5173'
console.log('AUTH_URL:', `https://anilist.co/api/v2/oauth/authorize?client_id=51565&redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}&response_type=code&state=${STATE}`)

const deadline = Date.now() + 4 * 60 * 1000
let token = null, expiresIn = null
process.stdout.write('polling')
while (Date.now() < deadline && !token) {
  try {
    const r = await fetch(`${ORIGIN}/api/anilist/relay-token?state=${encodeURIComponent(STATE)}`)
    const j = await r.json()
    if (j?.ok && j?.data?.token) { token = j.data.token; expiresIn = j.data.expiresIn }
  } catch {}
  if (!token) { process.stdout.write('.'); await new Promise((r) => setTimeout(r, 1500)) }
}
console.log('')
if (!token) { console.error('TIMEOUT'); process.exit(1) }

const v = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ query: 'query { Viewer { id name avatar { large } bannerImage } }' }),
})
const vj = await v.json()
const u = vj?.data?.Viewer
console.log('token_account:', u?.name)
if (u?.name !== 'Gre0dy') { console.error('ABORT — not Gre0dy'); process.exit(1) }

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 45000 })
const saved = await page.evaluate((token, expiresIn, u) => {
  localStorage.setItem('kurodo-anilist-auth', JSON.stringify({
    token, expiresAt: Date.now() + expiresIn * 1000,
    user: { id: u.id, name: u.name, avatar: u.avatar?.large ?? null, bannerImage: u.bannerImage ?? null },
  }))
  return 'SAVED'
}, token, expiresIn ?? 31536000, u)
console.log('persist:', saved)
await page.reload({ waitUntil: 'domcontentloaded' })
console.log('DONE — signed in as Gre0dy')
browser.disconnect()
process.exit(0)
