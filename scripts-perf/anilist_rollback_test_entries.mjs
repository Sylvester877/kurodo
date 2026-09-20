// ROLLBACK: delete the mass-sync test entries mistakenly created on ttplayx.
// Targets ONLY entries matching ALL of:
//   • media id ∈ re-derived test set (MAL 1..121 that resolved → AniList ids)
//   • progress == 1          (exactly what the test wrote)
//   • status CURRENT or null (test wrote bare progress; status auto-set CURRENT)
//   • updatedAt within the last 3 hours (the test window)
// Anything older, or with different progress/status, is LEFT UNTOUCHED.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }
const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token ?? null)
browser.disconnect()
if (!TOKEN) { console.error('NO_TOKEN'); process.exit(1) }

const API = 'https://graphql.anilist.co'
async function gql(query, variables, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ query, variables }),
    })
    if (r.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 2) * 1000 + 250); continue }
    const j = await r.json().catch(() => null)
    if (j?.data) return j.data
    if (j?.errors) throw new Error(j.errors[0]?.message ?? 'gql error')
    await sleep(1200)
  }
  throw new Error('gql failed')
}

// 1) Re-derive the exact test media-id set (MAL 1..121 that resolved).
const MAL_QUERY = `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id idMal } }`
const testIds = new Set()
for (let mal = 1; mal <= 121; mal++) {
  try {
    const d = await gql(MAL_QUERY, { idMal: mal })
    if (d?.Media?.id) testIds.add(d.Media.id)
  } catch { /* unmapped id — not in test set */ }
  await sleep(130)
}
console.log('test_set_size:', testIds.size)

// 2) Read the account list with updatedAt + progress + status.
const viewer = await gql(`query { Viewer { name } }`, {})
const name = viewer.Viewer.name
console.log('account:', name)
const list = await gql(`query ($name: String) {
  MediaListCollection(userName: $name, type: ANIME) {
    lists { entries { mediaId status progress updatedAt } }
  }
}`, { name })
const WINDOW_START = Date.now() / 1000 - 3 * 3600 // 3h window (test ran ~1h ago)
const candidates = []
for (const l of list.MediaListCollection.lists) {
  for (const e of l.entries) {
    if (!testIds.has(e.mediaId)) continue
    if ((e.progress ?? 0) !== 1) continue
    if (e.status != null && e.status !== 'CURRENT') continue
    if (!(e.updatedAt >= WINDOW_START)) continue
    candidates.push(e)
  }
}
console.log('rollback_candidates:', candidates.length)
if (process.argv.includes('--dry-run')) {
  console.log('DRY RUN — would delete:', JSON.stringify(candidates.map((c) => c.mediaId)))
  process.exit(0)
}

// 3) Delete each candidate entry.
const DEL = `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`
const SAVE = `query ($mediaId_int: Int) { Media(id: $mediaId_int) { id mediaListEntry { id } } }`
let deleted = 0, failed = 0
for (const c of candidates) {
  try {
    // Need the ENTRY id — fetch via Media.mediaListEntry.
    const m = await gql(SAVE, { mediaId_int: c.mediaId })
    const entryId = m?.Media?.mediaListEntry?.id
    if (!entryId) { failed++; continue }
    const d = await gql(DEL, { id: entryId })
    if (d?.DeleteMediaListEntry?.deleted) deleted++
    else failed++
  } catch { failed++ }
  await sleep(350)
}
console.log(`rollback_done: deleted=${deleted} failed=${failed}`)
console.log('NOTE: only progress==1 CURRENT entries from the test window were removed.')
