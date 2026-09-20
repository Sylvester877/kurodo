// Final read-back: count distinct Gre0dy entries with progress >= 1.
// Token comes from the live app's localStorage (never printed).
import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }
const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token ?? null)
browser.disconnect()
if (!TOKEN) { console.error('NO_TOKEN'); process.exit(1) }

const r = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({
    query: `query {
      Viewer { name }
      MediaListCollection(userName: "Gre0dy", type: ANIME) {
        lists { entries { mediaId progress status } }
      }
    }`,
  }),
})
const j = await r.json()
const lists = j?.data?.MediaListCollection?.lists ?? []
const withProgress = new Set()
for (const l of lists) for (const e of l.entries) if ((e.progress ?? 0) >= 1) withProgress.add(e.mediaId)
console.log('account:', j?.data?.Viewer?.name)
console.log('total_distinct_entries_progress_ge_1:', withProgress.size)
console.log(withProgress.size >= 100 ? 'VERDICT: PASS — 100+ animes synced to AniList' : 'VERDICT: CHECK — below 100')
process.exit(0)
