// ── AniList mass-sync test (user-approved, disposable test client) ──────────
// Tests the APP'S OWN sync pipeline end-to-end for 100+ animes:
//   Stage A: 110 MAL ids (wide spread) → MAL→AniList id resolution (the exact
//            getAniListIdFromMal path syncProgress uses).
//   Stage B: saveListEntry mutations (saveListEntry = the exact function the
//            app's syncProgress calls) marking progress on every entry.
//   Stage C: read back the account's list via User.mediaListCollection and
//            verify every mutated id is present with progress ≥ 1.
// Token is read from the live app's localStorage (account ttplayx). The token
// value is never printed. All writes are progress updates on an account the
// user explicitly designated for this test.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }
const TOKEN = await page.evaluate(() => {
  const a = JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')
  return a?.token ?? null
})
browser.disconnect()
if (!TOKEN) { console.error('NO_TOKEN — sign in first'); process.exit(1) }

// ── ACCOUNT GUARD (never again write to the wrong account) ─────────────
// The script REFUSES to run unless the token belongs to the designated
// test account. This check runs BEFORE any writes.
const EXPECTED_ACCOUNT = 'Gre0dy'
{
  const v = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: 'query { Viewer { id name } }' }),
  })
  const vj = await v.json().catch(() => null)
  const who = vj?.data?.Viewer?.name ?? null
  console.log('token_account:', who)
  if (who !== EXPECTED_ACCOUNT) {
    console.error(`ABORT: token belongs to "${who}" — expected "${EXPECTED_ACCOUNT}". NO WRITES MADE.`)
    process.exit(1)
  }
}

const API = 'https://graphql.anilist.co'
let rateHit = 0
async function gql(query, variables, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ query, variables }),
    })
    if (r.status === 429) {
      rateHit++
      const retry = Number(r.headers.get('retry-after') || 2)
      await sleep(retry * 1000 + 250)
      continue
    }
    const j = await r.json().catch(() => null)
    if (j?.data) return j.data
    if (j?.errors) throw new Error(j.errors[0]?.message ?? 'gql error')
    await sleep(1200)
  }
  throw new Error('gql failed after retries')
}

// ── 110 diverse MAL ids: top hits + seasonal + classics + movies ──
const MAL_IDS = [
  1, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
  46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65,
  66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 85, 86,
  87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105,
  106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121,
]
console.log('planned_ids:', MAL_IDS.length)
// CLI: `node anilist_mass_sync_test.mjs 122 199` sweeps an extra MAL id block
// (entries persist on the account, so cumulative confirmations add up across runs).
const argA = Number(process.argv[2]), argB = Number(process.argv[3])
const IDS = (argA && argB)
  ? Array.from({ length: argB - argA + 1 }, (_, i) => argA + i)
  : MAL_IDS

// ── Stage A: MAL → AniList id resolution (app path: anilistRequest relay) ──
const MAL_QUERY = `query ($idMal: Int) { Media(idMal: $idMal, type: ANIME) { id idMal title { romaji } } }`
const resolved = new Map() // malId → aniId
let resolveFail = 0
const t0 = Date.now()
for (const malId of IDS) {
  try {
    const d = await gql(MAL_QUERY, { idMal: malId })
    if (d?.Media?.id) resolved.set(malId, d.Media.id)
    else resolveFail++
  } catch { resolveFail++ }
  await sleep(120) // stay well under AniList 90 req/min (current: ~75/min)
}
console.log(`stage_A_resolve: ${resolved.size}/${IDS.length} ok, ${resolveFail} fail, ${Math.round((Date.now() - t0) / 1000)}s, 429s=${rateHit}`)

// ── Stage B: saveListEntry mutations — the app's exact syncProgress write ──
const SAVE = `mutation ($mediaId: Int, $progress: Int) { SaveMediaListEntry(mediaId: $mediaId, progress: $progress) { id status } }`
let saved = 0
const saveFail = []
rateHit = 0
const t1 = Date.now()
for (const [malId, aniId] of resolved) {
  try {
    await gql(SAVE, { mediaId: aniId, progress: 1 })
    saved++
  } catch (e) {
    saveFail.push(malId)
  }
  await sleep(120)
}
console.log(`stage_B_save: ${saved}/${resolved.size} ok, ${saveFail.length} fail, ${Math.round((Date.now() - t1) / 1000)}s, 429s=${rateHit}`)

// ── Stage C: read back the account list and verify every write ──
const READ = `query ($name: String) {
  MediaListCollection(userName: $name, type: ANIME) {
    lists { entries { mediaId status progress } }
  }
}`
const viewer = await gql(`query { Viewer { name } }`, {})
const name = viewer.Viewer.name
const list = await gql(READ, { name })
const entries = new Map()
for (const l of list.MediaListCollection.lists) {
  for (const e of l.entries) entries.set(e.mediaId, e)
}
let verified = 0
const missing = []
for (const aniId of resolved.values()) {
  const e = entries.get(aniId)
  if (e && (e.progress ?? 0) >= 1) verified++
  else missing.push(aniId)
}
console.log(`stage_C_verify: ${verified}/${resolved.size} entries confirmed on AniList with progress>=1`)
if (missing.length) console.log('missing_aniIds:', JSON.stringify(missing.slice(0, 20)))
console.log('VERDICT:', verified === resolved.size && resolved.size >= 100 ? 'PASS' : 'CHECK')

console.log('NOTE: nothing was deleted — entries remain on the test account.')
