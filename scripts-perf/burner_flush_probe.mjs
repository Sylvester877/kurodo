// Reproduce the app's failing saveListEntry INSIDE the live page (same
// origin, same token, same code path) to surface AniList's real error,
// then trigger the pending-queue flush and report the result.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

const result = await page.evaluate(async () => {
  const out = {}
  const a = JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')
  const token = a?.token
  if (!token) return { error: 'NO_TOKEN' }

  // The exact query anilistAuth.saveListEntry uses (mediaId + status + progress).
  const Q = `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
    SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) { id status progress }
  }`
  const call = async (vars) => {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body: JSON.stringify({ query: Q, variables: vars }),
    })
    let j = null
    try { j = await r.json() } catch {}
    return { status: r.status, ratelimit: r.headers.get('x-ratelimit-remaining'), body: j }
  }

  // 1) Resolve MAL 21 → AniList id via the app's own relay (like getAniListIdFromMal).
  const q2 = await fetch('http://localhost:5173/api/anilist-gql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `query ($id: Int) { Media(id: $id, type: ANIME) { id idMal } }`, variables: { id: 21 } }),
  })
  const j2 = await q2.json().catch(() => null)
  out.resolveStatus = q2.status
  out.aniId = j2?.data?.Media?.id ?? null

  // 2) The exact save with status CURRENT (what syncProgress sends).
  if (out.aniId) {
    out.save = await call({ mediaId: out.aniId, status: 'CURRENT', progress: 6 })
  }
  return out
})
console.log(JSON.stringify(result, null, 2).slice(0, 900))

// 3) Now trigger the app's own flush (re-run initSyncBridge's flush via an
//    offline/online event — the app flushes on 'online').
await page.evaluate(() => { window.dispatchEvent(new Event('online')) })
await sleep(4000)
const pending = await page.evaluate(() => {
  const raw = localStorage.getItem('kurodo-pending-anilist-progress')
  return raw ? Object.keys(JSON.parse(raw)).length : 0
})
console.log('pending_after_flush:', pending)
browser.disconnect()
process.exit(0)
