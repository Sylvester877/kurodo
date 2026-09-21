// Confirm the localhost vs 127.0.0.1 localStorage split, replay the orphaned
// pending queue (from the wrong-origin page) into AniList, clear it, and
// leave the app parked on localhost (the origin that holds the session).
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

// Token from the LOCALHOST origin (where the app session lives).
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(2000)
const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token ?? null)
console.log('localhost_token_present:', !!TOKEN)
if (!TOKEN) { console.error('NO_TOKEN on localhost'); process.exit(1) }

// Read the orphaned queue on the 127.0.0.1 origin.
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 45000 })
await sleep(1500)
const orphan = await page.evaluate(() => {
  const raw = localStorage.getItem('kurodo-pending-anilist-progress')
  const q = raw ? JSON.parse(raw) : {}
  const auth = JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')
  return { queue: q, originHasToken: !!auth?.token }
})
console.log('orIGIN_127_has_token:', orphan.originHasToken, '| orphaned_queue:', JSON.stringify(orphan.queue))

// Replay every orphaned entry to AniList from Node (token never printed).
const API = 'https://graphql.anilist.co'
const gql = async (query, variables) => {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  })
  if (r.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 2) * 1000 + 250); return gql(query, variables) }
  const j = await r.json()
  if (j.errors) throw new Error(j.errors[0]?.message)
  return j.data
}
const v = await gql(`query { Viewer { name } }`, {})
console.log('replay_account:', v.Viewer.name)
if (v.Viewer.name !== 'Gre0dy') { console.error('ABORT — not Gre0dy'); process.exit(1) }

const malToAni = new Map()
for (const malIdStr of Object.keys(orphan.queue)) {
  const malId = Number(malIdStr)
  const d = await gql(`query ($id: Int) { Media(idMal: $id, type: ANIME) { id } }`, { id: malId }).catch(() => null)
  if (d?.Media?.id) malToAni.set(malId, d.Media.id)
  await sleep(400)
}
let ok = 0
for (const [malId, aniId] of malToAni) {
  const ep = orphan.queue[String(malId)]
  try {
    await gql(`mutation ($mediaId: Int, $progress: Int) { SaveMediaListEntry(mediaId: $mediaId, progress: $progress) { id progress } }`, { mediaId: aniId, progress: ep })
    ok++
  } catch (e) { console.log(`save fail MAL ${malId} ep ${ep}:`, e.message) }
  await sleep(400)
}
console.log(`replayed: ${ok}/${malToAni.size}`)

// Clear the orphaned queue on the 127 origin.
await page.evaluate(() => localStorage.removeItem('kurodo-pending-anilist-progress'))
// Park the app back on localhost (the session origin).
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 45000 })
console.log('app_parked_on: localhost')
browser.disconnect()
process.exit(0)
