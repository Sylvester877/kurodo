// Drive the REAL AniList authorize flow in the live Electron window and
// exchange the resulting fresh code with the stored pair in multiple styles.
// Prints verdicts; secrets never printed (lengths only).
import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// env pair
const env = fs.readFileSync('.env.local', 'utf8')
const envMap = {}
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/)
  if (m) envMap[m[1].trim()] = m[2].trim()
}
const clientId = envMap.VITE_ANILIST_CLIENT_ID
const clientSecret = envMap.ANILIST_CLIENT_SECRET

// 1. authorize (new tab so we don't nuke the app's state)
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }
const originalUrl = page.url()
console.log('borrowing live window (will restore):', originalUrl.slice(0, 80))
const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('http://localhost:5173/auth/callback')}&response_type=code`
console.log('navigating to authorize…')
await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('nav:', e.message))
await sleep(6000)
console.log('landed on:', page.url().slice(0, 120))

// 2. pull ?code= if we got redirected
const url = page.url()
const code = new URL(url).searchParams.get('code')
if (!code) {
  console.log('NO_CODE — authorize page did not auto-redirect (needs manual consent). URL:', url.slice(0, 200))
  await page.screenshot({ path: 'screenshots/anilist-authorize-state.png' })
  process.exit(2)
}
console.log('got REAL code:', code.slice(0, 8) + '…', 'len', code.length)

// 3. exchange attempts with the REAL code
const redirectUri = 'http://localhost:5173/auth/callback'
async function post(body, headers) {
  const res = await fetch('https://anilist.co/api/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
    body: new URLSearchParams(body).toString(),
  })
  return { status: res.status, json: await res.json().catch(() => null) }
}

const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

const attempts = [
  ['form secret', { grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code }, {}],
  ['Basic header', { grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code }, { Authorization: `Basic ${basic}` }],
]
let ok = null
for (const [label, body, headers] of attempts) {
  const r = await post(body, headers)
  console.log(`[${label}] → HTTP ${r.status}`, JSON.stringify(r.json).slice(0, 160))
  if (r.json?.access_token) { ok = { label, token: r.json.access_token }; break }
}

if (ok) {
  console.log(`\n✅ PAIR IS VALID (${ok.label} worked). Token len ${ok.token.length}.`)
  console.log('=> The app-side bug must be in HOW the app sends the request, not the credentials.')
} else {
  console.log('\n❌ REAL code also fails with invalid_client → the stored ID+secret pair is genuinely rejected.')
  console.log('=> Fix: regenerate the Client Secret at https://anilist.co/settings/developer (client ID ' + clientId + ') and update .env.local.')
}
// restore the app view
await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
process.exit(0)
