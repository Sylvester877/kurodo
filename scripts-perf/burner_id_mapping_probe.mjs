// Which AniList id does the app's lookup path return for MAL 5114?
// Compare: (a) the app's page-context query (through relay + client cache),
// (b) a fresh node-side query to graphql.anilist.co.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(3000)

// (a) app path — same query getAniListIdFromMal uses
const appAnswer = await page.evaluate(async () => {
  const q = `query ($malId: Int) { Media(idMal: $malId, type: ANIME) { id } }`
  const r = await fetch('/api/anilist-gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, variables: { malId: 5114 } }),
  })
  const j = await r.json()
  return { status: r.status, id: j?.data?.Media?.id ?? null, errors: j?.errors?.map((e) => e.message)?.slice(0, 2) }
})
console.log('APP-PATH  :', JSON.stringify(appAnswer))
await sleep(1000)

// (b) fresh direct
const direct = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'query ($malId: Int) { Media(idMal: $malId, type: ANIME) { id title { romaji } } }', variables: { malId: 5114 } }),
})
const dj = await direct.json()
console.log('DIRECT    :', JSON.stringify(dj?.data))
browser.disconnect()
