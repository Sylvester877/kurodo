// Full error dump: scoreRaw mutation reply + Viewer read.
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }

const w = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    query: `mutation ($m: Int, $sr: Int) { SaveMediaListEntry(mediaId: $m, scoreRaw: $sr) { id scoreRaw } }`,
    variables: { m: 5114, sr: 80 },
  }),
})
console.log('status:', w.status)
console.log(JSON.stringify(await w.json(), null, 2).slice(0, 500))
const r = await fetch('https://graphql.anilist.co', { method: 'POST', headers: H, body: JSON.stringify({ query: 'query { Viewer { name } Media(id: 5114) { id mediaListEntry { id } } }' }) })
console.log('viewer/media:', JSON.stringify(await r.json()).slice(0, 300))
browser.disconnect()
