// Test D v3 — offline queue flush (auth-subscribe trigger).
//   1. sign out (clear auth) + seed pending queue "watched ep 3"
//   2. restore auth (token change fires flushPendingProgress)
//   3. read back by idMal — the app resolves MAL→AniList itself.
// NOTE: MAL 16498 → AniList 16498 (Shingeki no Kyojin). All AniList reads
// here go through idMal so a wrong hard-coded ani id can never lie to us.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173'
const GRAPHQL = 'https://graphql.anilist.co'
const MAL_ID = 16498
const TARGET_EP = 3

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(4000)

const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
const who = (await (await fetch(GRAPHQL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ query: 'query { Viewer { name } }' }) })).json())?.data?.Viewer?.name
if (who !== 'Gre0dy') { console.error('ABORT —', who); process.exit(1) }
console.log('guard: Gre0dy ✓')

const gqlNode = async (query, variables) => (await fetch(GRAPHQL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query, variables }),
})).json()

// Baseline + reset (by idMal)
const aniIdResolved = (await gqlNode('query ($m: Int) { Media(idMal: $m) { id } }', { m: MAL_ID }))?.data?.Media?.id
console.log('resolved ani id for MAL', MAL_ID, '→', aniIdResolved)
let base = (await gqlNode('query ($m: Int) { Media(idMal: $m) { mediaListEntry { status progress } } }', { m: MAL_ID }))?.data?.Media?.mediaListEntry
console.log('baseline:', JSON.stringify(base))
if ((base?.progress ?? 0) >= TARGET_EP || !base) {
  await gqlNode(`mutation ($m: Int, $p: Int) { SaveMediaListEntry(mediaId: $m, progress: $p) { id } }`, { m: aniIdResolved, p: 0 })
  console.log('reset progress to 0')
  await sleep(1500)
}

// 1. Sign out + seed queue
await page.evaluate(() => {
  localStorage.setItem('kurodo-anilist-auth-backup', localStorage.getItem('kurodo-anilist-auth'))
  localStorage.removeItem('kurodo-anilist-auth')
  localStorage.setItem('kurodo-pending-anilist-progress', JSON.stringify({ '16498': 3 }))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(5000)
console.log('signed out + queue seeded: MAL', MAL_ID, '→ ep', TARGET_EP)

// 2. Sign back in (token change → flush)
await page.evaluate(() => {
  localStorage.setItem('kurodo-anilist-auth', localStorage.getItem('kurodo-anilist-auth-backup'))
  localStorage.removeItem('kurodo-anilist-auth-backup')
})
await page.reload({ waitUntil: 'domcontentloaded' })
console.log('reloaded with token — waiting for flush…')

// 3. Verify (by idMal)
let final = null
for (let i = 0; i < 15; i++) {
  await sleep(3000)
  final = (await gqlNode('query ($m: Int) { Media(idMal: $m) { mediaListEntry { status progress } } }', { m: MAL_ID }))?.data?.Media?.mediaListEntry
  if ((final?.progress ?? 0) >= TARGET_EP) break
}
const queueNow = await page.evaluate(() => localStorage.getItem('kurodo-pending-anilist-progress'))
console.log('final entry:', JSON.stringify(final), '| queue:', queueNow)
const pass = (final?.progress ?? 0) >= TARGET_EP
console.log('\nTEST-D-offline-queue:', pass ? 'PASS' : 'FAIL')

// cleanup
await gqlNode(`mutation ($m: Int, $p: Int) { SaveMediaListEntry(mediaId: $m, progress: $p) { id } }`, { m: aniIdResolved, p: 0 })
console.log('cleanup: progress reset')
process.exit(pass ? 0 : 1)
