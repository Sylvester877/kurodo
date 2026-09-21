// Test A v2 — score round-trip through the REAL CompletionDialog.
// The setup write uses a node-side fetch (no page cache), then the dialog
// flow is driven in-page, then the score is read back node-side.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173'
const MAL_ID = 5114
const ANI_ID = 5114 // fixes: 101922 was Kimetsu no Yaiba (MAL 38000) — AniList id for MAL 5114 is 5114 (FMA:B)
const GRAPHQL = 'https://graphql.anilist.co'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(4000)

const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
const gqlNode = async (query, variables) => {
  const r = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  })
  return r.json()
}
const who = (await gqlNode('query { Viewer { name } }'))?.data?.Viewer?.name
if (who !== 'Gre0dy') { console.error('ABORT —', who); process.exit(1) }
console.log('guard: Gre0dy ✓')

// 1. Setup: COMPLETED with progress = 64, score 0 (node-side, retry until it sticks)
let ok = false
for (let i = 0; i < 5 && !ok; i++) {
  const j = await gqlNode(
    `mutation ($m: Int, $s: MediaListStatus, $p: Int, $sc: Float) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p, score: $sc) { id status progress score } }`,
    { m: ANI_ID, s: 'COMPLETED', p: 64, sc: 0 },
  )
  ok = j?.data?.SaveMediaListEntry?.status === 'COMPLETED'
  if (!ok) { console.log('setup attempt', i + 1, JSON.stringify(j?.errors ?? j?.data).slice(0, 160)); await sleep(3000) }
}
if (!ok) { console.error('SETUP FAILED after retries'); process.exit(1) }
let entry = (await gqlNode('query ($m: Int) { Media(idMal: $m) { mediaListEntry { id status progress score } } }', { m: MAL_ID }))?.data?.Media?.mediaListEntry
console.log('setup entry:', JSON.stringify(entry))

// 2. Fire the completion event in-page
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('kurodo:anime-completed', {
    detail: { malId: 5114, aniId: 5114, title: 'Fullmetal Alchemist: Brotherhood', totalEpisodes: 64 },
  }))
})
await sleep(2500)
const dlgVisible = await page.evaluate(() => document.body.innerText.includes('completed') || !!document.querySelector('[role="dialog"]'))
console.log('dialog visible:', dlgVisible)

// 3. Click 4th star then submit (in-page)
// 3. Click stars using REAL mouse events (React synthetic listeners +
//    framer-motion transform make element.click() unreliable here).
const realClick = async (sel) => {
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  }, sel)
  if (!box) return false
  await page.mouse.move(box.x, box.y)
  await sleep(150)
  await page.mouse.down()
  await sleep(80)
  await page.mouse.up()
  return true
}
const starClicked = await realClick('button[aria-label="Rate 8 out of 10"]')
console.log('8th star:', starClicked)
await sleep(1200)
const ratingShown = await page.evaluate(() => document.body.innerText.includes('8/10'))
console.log('8/10 shown in dialog:', ratingShown)
const submitClicked = await realClick('button[aria-label="Rate 8 out of 10"]') ? 'PENDING' : 'NO_STAR'
// submit button label is `Rate 8/10` once rating is set — click by text via
// a coordinate scan over all buttons.
const submitBox = await page.evaluate(() => {
  const submit = [...document.querySelectorAll('button')].find((b) => /^Rate 8\/10$/.test((b.textContent || '').trim()))
  if (!submit) return null
  const r = submit.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
let submitLabel = 'NO_SUBMIT'
if (submitBox) {
  await page.mouse.move(submitBox.x, submitBox.y)
  await sleep(150)
  await page.mouse.down()
  await sleep(80)
  await page.mouse.up()
  submitLabel = 'CLICKED:Rate 8/10'
}
console.log('submit:', submitClicked === 'PENDING' ? submitLabel : submitClicked)
await sleep(7000)

// 4. Read back the score — score() in the user's format (POINT_10 → 8),
//    score(format: POINT_100) → 80 (scoreRaw is stored ÷10 for POINT_10).
let scoreOk = false
for (let i = 0; i < 6 && !scoreOk; i++) {
  entry = (await gqlNode('query ($m: Int) { Media(idMal: $m) { mediaListEntry { id status progress score score100: score(format: POINT_100) } } }', { m: MAL_ID }))?.data?.Media?.mediaListEntry
  scoreOk = entry?.score100 === 80
  if (!scoreOk) await sleep(2500)
}
console.log('final entry:', JSON.stringify(entry))
console.log('\nTEST-A-score:', scoreOk ? 'PASS' : 'FAIL', '(expected POINT_100=80, got', entry?.score100 + ')')

// cleanup: score back to 0
await gqlNode(`mutation ($m: Int, $sc: Float) { SaveMediaListEntry(mediaId: $m, score: $sc) { id score } }`, { m: ANI_ID, sc: 0 })
console.log('cleanup: score reset')
process.exit(scoreOk ? 0 : 1)
