// Trace v4: click Rate 8/10 by scanning ALL buttons with coordinates from
// the page (no selector mismatch), and dump dialog state after the click.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const GRAPHQL = 'https://graphql.anilist.co'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(4000)

const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
const gqlNode = async (query, variables) => (await fetch(GRAPHQL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query, variables }),
})).json()

await gqlNode(`mutation ($m: Int, $s: MediaListStatus, $p: Int, $sc: Float) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p, score: $sc) { id status score } }`, { m: 5114, s: 'COMPLETED', p: 64, sc: 0 })

const logs = []
page.on('console', (m) => { try { logs.push(m.text()) } catch {} })

await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('kurodo:anime-completed', {
    detail: { malId: 5114, aniId: 5114, title: 'Fullmetal Alchemist: Brotherhood', totalEpisodes: 64 },
  }))
})
await sleep(2500)

const mouseClickAt = async (box) => {
  await page.mouse.move(box.x, box.y)
  await sleep(150)
  await page.mouse.down()
  await sleep(80)
  await page.mouse.up()
}

// star 8
const starBox = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Rate 8 out of 10"]')
  if (!btn) return null
  const r = btn.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (starBox) await mouseClickAt(starBox)
await sleep(1000)
console.log('after star, dialog text:', await page.evaluate(() => document.querySelector('.fixed.z-\\[90\\], [class*="z-90"]')?.textContent?.slice(0, 200) ?? 'NOT FOUND'))

// submit — full in-page scan incl. class hints
const submitBox = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')]
  const btn = btns.find((b) => {
    const t = (b.textContent || '').trim()
    return t === 'Rate 8/10' || (t.includes('Rate') && t.includes('8'))
  })
  if (!btn) return { miss: btns.map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 15) }
  const r = btn.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
console.log('submit scan:', JSON.stringify(submitBox))
if (submitBox?.x) {
  await mouseClickAt(submitBox)
  await sleep(7000)
}
console.log('--- console lines ---')
for (const l of logs.slice(-12)) console.log(l)
const entry = await gqlNode('query { Media(id: 5114) { mediaListEntry { score status progress } } }')
console.log('entry after submit:', JSON.stringify(entry?.data?.Media?.mediaListEntry))
await gqlNode(`mutation ($m: Int, $sc: Float) { SaveMediaListEntry(mediaId: $m, score: $sc) { id score } }`, { m: 5114, sc: 0 })
process.exit(0)
