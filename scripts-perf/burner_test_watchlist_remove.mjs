// Test C part 2 — the Remove leg. The button IS rendered (probe confirms
// rmBtn: true). Fresh page, click by aria-label, verify deletion on AniList.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173'
const GRAPHQL = 'https://graphql.anilist.co'
const MAL_ID = 5114

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]

const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
const gql = async (query, variables) => (await fetch(GRAPHQL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query, variables }),
})).json()
const readEntry = async () => {
  const j = await gql(`query ($mal: Int) { Media(idMal: $mal) { id mediaListEntry { id status progress } } }`, { mal: MAL_ID })
  return j?.data?.Media?.mediaListEntry ?? null
}

console.log('entry before:', JSON.stringify(await readEntry()))

await page.goto(`${ORIGIN}/anime/${MAL_ID}`, { waitUntil: 'domcontentloaded' })
await sleep(8000)

// Click the Remove button (probe says it's there)
const clicked = await page.evaluate(() => {
  const el = document.querySelector('button[aria-label="Remove from watchlist"]')
  if (!el) return 'NO_BUTTON'
  el.scrollIntoView({ block: 'center' })
  el.click()
  return 'CLICKED'
})
console.log('remove click:', clicked)

// Wait for the local store to drop FMA:B
let localGone = false
for (let i = 0; i < 10; i++) {
  await sleep(1500)
  localGone = await page.evaluate(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('kurodo-watchlist') || '{}')?.state?.watchlist ?? []
      return !parsed.some((a) => a.mal_id === 5114)
    } catch { return false }
  })
  if (localGone) break
}
console.log('local removed:', localGone)

// Wait for AniList entry to disappear
let entry = await readEntry()
for (let i = 0; i < 10; i++) {
  if (!entry) break
  await sleep(2000)
  entry = await readEntry()
}
console.log('TEST-C-remove:', !entry ? 'PASS' : 'FAIL', JSON.stringify(entry))
console.log('\nVERDICT:', localGone && !entry ? 'PASS' : 'FAIL')
process.exit(localGone && !entry ? 0 : 1)
