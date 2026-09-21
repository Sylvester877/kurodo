// Burner-account manga sync test:
//   0. Guard: app token must be Gre0dy.
//   1. Reset Berserk (MAL 2 → AniList 30002) on AniList: delete entry.
//   2. MangaDetails /manga/2: click "Start Reading" (adds to local manga list).
//   3. Open the reader via the first /manga/read/ link (carries malId).
//   4. Jump to the last page (mark-read fires at >=90% of pages).
//   5. Accept the sync-confirm dialog if it appears.
//   6. Poll AniList for a MANGA entry with progress >= 1.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173'
const GRAPHQL = 'https://graphql.anilist.co'
const MAL_ID = 2
const ANI_ID = 30002

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
const readMangaEntry = async () => (await gqlNode('query ($m: Int) { Media(id: $m, type: MANGA) { mediaListEntry { id status progress } } }', { m: ANI_ID }))?.data?.Media?.mediaListEntry ?? null

// 1. Clean AniList entry
const pre = await readMangaEntry()
if (pre?.id) {
  await gqlNode(`mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`, { id: pre.id })
  console.log('deleted AniList manga entry')
  await sleep(1500)
} else {
  console.log('AniList manga entry: none (clean)')
}

// 2. Details page → Start Reading (adds to local list)
await page.goto(`${ORIGIN}/manga/${MAL_ID}`, { waitUntil: 'domcontentloaded' })
await sleep(10000)
const addClicked = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button')].find((b) => /^Start Reading$/.test((b.textContent || '').trim()))
  if (!el) return 'NO_BUTTON'
  el.click()
  return 'CLICKED'
})
console.log('Start Reading:', addClicked)
await sleep(3000)

// 3. Find a reader link (now that we're in the list, chapter links render)
let readerHref = null
for (let i = 0; i < 10 && !readerHref; i++) {
  readerHref = await page.evaluate((mal) => {
    const a = [...document.querySelectorAll('a')].find((x) => x.pathname.startsWith('/manga/read/') && x.search.includes(`malId=${mal}`))
    return a ? a.getAttribute('href') : null
  }, MAL_ID)
  if (!readerHref) await sleep(2500)
}
if (!readerHref) {
  // fallback: Start Reading CTA may itself navigate via onClick after adding
  readerHref = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find((x) => x.pathname.startsWith('/manga/read/'))
    return a ? a.getAttribute('href') : null
  })
}
console.log('reader link:', readerHref)
if (!readerHref) { console.error('FAIL — no reader link'); process.exit(1) }

// 4. Open reader, pre-opt into sync (set the confirm choice so no dialog blocks)
await page.evaluate((mal) => {
  const choices = JSON.parse(localStorage.getItem('kurodo-sync-choices') || '{}')
  choices[`manga:${mal}`] = true
  localStorage.setItem('kurodo-sync-choices', JSON.stringify(choices))
}, MAL_ID)
await page.goto(`${ORIGIN}${readerHref}`, { waitUntil: 'domcontentloaded' })
await sleep(12000)
const readerState = await page.evaluate(() => ({
  url: location.pathname + location.search,
  bigImgs: [...document.querySelectorAll('img')].filter((i) => (i.naturalWidth || 0) > 400).length,
}))
console.log('reader:', JSON.stringify(readerState))
if (!readerState.url.includes('malId')) { console.error('FAIL — reader URL missing malId, tracking would be null'); process.exit(1) }

// Jump to the last page (page-mode mark-read fires at >=90%)
const jumped = await page.evaluate(() => {
  // scroll container varies; try common ones
  const scrollers = [document.querySelector('[class*="reader"]'), document.scrollingElement]
  for (const el of scrollers) {
    if (!el) continue
    const max = el.scrollHeight - el.clientHeight
    if (max > 0) { el.scrollTop = max; window.scrollTo(0, max); return true }
  }
  window.scrollTo(0, document.body.scrollHeight)
  return true
})
console.log('jumped to end:', jumped)

// wait for the 90% mark + sync
let entry = null
for (let i = 0; i < 20; i++) {
  await sleep(3000)
  entry = await readMangaEntry()
  if (entry) break
}
console.log('AniList manga entry:', JSON.stringify(entry))
const pass = !!entry && (entry.progress ?? 0) >= 1
console.log('\nVERDICT:', pass ? 'PASS' : 'FAIL')

// cleanup: delete the manga entry so the test is re-runnable
if (entry?.id) {
  await gqlNode(`mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`, { id: entry.id })
  console.log('cleanup: AniList manga entry deleted')
}
process.exit(pass ? 0 : 1)
