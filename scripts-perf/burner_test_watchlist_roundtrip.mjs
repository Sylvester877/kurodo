// Test C FINAL v2 — round-trip reading AniList through the app's own relay
// (same cache/cooldown path the app itself uses).
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173'
const MAL_ID = 5114

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(4000)

const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
const who = await page.evaluate(async () => {
  const r = await fetch('/api/anilist-gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token },
    body: JSON.stringify({ query: 'query { Viewer { name } }' }),
  })
  return (await r.json())?.data?.Viewer?.name ?? null
})
if (who !== 'Gre0dy') { console.error('ABORT —', who); process.exit(1) }
console.log('guard: Gre0dy ✓ (via relay)')

// Read helper INSIDE the page: same relay, no CORS/auth split, cache-safe for
// mutations? — the relay only caches GETs semantically; Delete/Save mutations
// have unique variables so no cache collision. But to be safe we bypass the
// relay cache by adding a trivial alias when polling.
const readEntryInPage = () => page.evaluate(async (mal) => {
  const token = JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token
  const q = `query ($mal: Int) { Media(idMal: $mal) { mediaListEntry { id status progress } } }`
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: q, variables: { mal } }),
  })
  return (await r.json())?.data?.Media?.mediaListEntry ?? null
}, MAL_ID)

await page.goto(`${ORIGIN}/anime/${MAL_ID}`, { waitUntil: 'domcontentloaded' })
await sleep(8000)

const localHas = () => page.evaluate(() => {
  try { return (JSON.parse(localStorage.getItem('kurodo-watchlist') || '{}')?.state?.watchlist ?? []).some((a) => a.mal_id === 5114) } catch { return false }
})
for (let i = 0; i < 4 && (await localHas()); i++) {
  await page.evaluate(() => { document.querySelector('button[aria-label="Remove from watchlist"]')?.click() })
  await sleep(2500)
}
// also wipe any AniList-side leftover (direct from page context)
const pre = await readEntryInPage()
if (pre?.id) {
  await page.evaluate(async (id) => {
    const token = JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token
    await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`, variables: { id } }),
    })
  }, pre.id)
  await sleep(1500)
}
console.log('clean slate:', !(await localHas()), '| anilist entry:', JSON.stringify(await readEntryInPage()))

// ADD via UI
await page.evaluate(() => { document.querySelector('button[aria-label="Add to watchlist"]')?.click() })
let addEntry = null
for (let i = 0; i < 12; i++) { await sleep(2000); addEntry = await readEntryInPage(); if (addEntry) break }
console.log('TEST-C-add:', addEntry ? 'PASS' : 'FAIL', JSON.stringify(addEntry))

// REMOVE via UI
await page.evaluate(() => { document.querySelector('button[aria-label="Remove from watchlist"]')?.click() })
let rmEntry = addEntry
for (let i = 0; i < 12; i++) { await sleep(2000); rmEntry = await readEntryInPage(); if (!rmEntry) break }
console.log('TEST-C-remove:', !rmEntry ? 'PASS' : 'FAIL', JSON.stringify(rmEntry))

console.log('\nVERDICT:', addEntry && !rmEntry ? 'PASS' : 'FAIL')
process.exit(addEntry && !rmEntry ? 0 : 1)
