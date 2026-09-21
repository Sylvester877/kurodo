// A/B: delete entry 596612885 DIRECT vs through the backend relay.
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
const ENTRY = 596612885
const gql = `mutation ($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }`
const vars = { id: ENTRY }

// A: direct
const a = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  body: JSON.stringify({ query: gql, variables: vars }),
})
console.log('DIRECT status:', a.status, '| body:', JSON.stringify(await a.json()).slice(0, 300))

// Recreate the entry so B has something to delete
const rec = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: `mutation ($m: Int, $s: MediaListStatus, $p: Int) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p) { id } }`, variables: { m: 101922, s: 'CURRENT', p: 0 } }),
})
const recJ = await rec.json()
const freshId = recJ?.data?.SaveMediaListEntry?.id
console.log('recreated entry id:', freshId)

// B: through the relay (exactly what the app's anilistClient does)
const b = await fetch('http://localhost:5173/api/anilist-gql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
  body: JSON.stringify({ query: gql, variables: { id: freshId } }),
})
console.log('RELAY status:', b.status, '| body:', JSON.stringify(await b.json()).slice(0, 300))
browser.disconnect()
