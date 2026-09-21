// Test B — auto-COMPLETED: play the FINAL episode of a short series in the
// real player, let the near-end mark fire, verify AniList status COMPLETED.
// Target: MAL 1 (Cowboy Bebop, 26 eps) — set progress 25 first, then watch ep 26.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173'
const GRAPHQL = 'https://graphql.anilist.co'
const MAL_ID = 1
const ANI_ID = 1 // Cowboy Bebop: AniList id 1

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

// Setup: CURRENT progress 25 (one below final)
let ok = false
for (let i = 0; i < 5 && !ok; i++) {
  const j = await gqlNode(`mutation ($m: Int, $s: MediaListStatus, $p: Int) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p) { id status progress } }`, { m: ANI_ID, s: 'CURRENT', p: 25 })
  ok = j?.data?.SaveMediaListEntry?.progress === 25
  if (!ok) await sleep(2500)
}
console.log('setup: progress=25 CURRENT:', ok)
if (!ok) process.exit(1)

// Open ep 26 (the final episode) in the real player
await page.goto(`${ORIGIN}/watch/1?ep=26`, { waitUntil: 'domcontentloaded' })
await sleep(5000)
// settle: app rewrites URL after mount
const ev = async (fn) => {
  for (let i = 0; i < 5; i++) {
    try { return await page.evaluate(fn) } catch (e) {
      if (!/context was destroyed|navigat/i.test(e.message)) throw e
      await sleep(1500)
    }
  }
  return null
}
let ready = false
for (let i = 0; i < 60 && !ready; i++) {
  ready = (await ev(() => { const v = document.querySelector('video'); return !!v && v.readyState >= 2 && v.duration > 0 })) === true
  if (!ready) await sleep(1000)
}
console.log('video_ready:', ready)
if (!ready) process.exit(1)

// Mute + 4x + seek near end
await ev(() => {
  const v = document.querySelector('video')
  v.muted = true
  v.playbackRate = 4
  v.currentTime = Math.max(0, v.duration - 25)
  v.play().catch(() => {})
  return true
})
console.log('seek near end — waiting…')

// Self-healing wait loop
let done = false
for (let i = 0; i < 60 && !done; i++) {
  const st = await ev(() => {
    const vids = [...document.querySelectorAll('video')]
    const v = vids.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0]
    if (!v) return null
    if (v.paused && !v.ended) v.play().catch(() => {})
    return { ct: v.currentTime, dur: v.duration, ended: v.ended }
  })
  if (st) {
    if (st.ended || (st.dur > 0 && st.ct >= st.dur - 0.5)) { done = true; break }
    if (st.dur > 0 && st.ct < st.dur - 45) {
      await ev(() => { const v = document.querySelector('video'); if (v) v.currentTime = Math.max(0, v.duration - 20); return true })
    }
  }
  await sleep(2000)
}
console.log('video finished:', done)
await sleep(8000) // mark + sync latency

// Verify: status must be COMPLETED, progress 26
let final = null
for (let i = 0; i < 6; i++) {
  final = (await gqlNode('query ($m: Int) { Media(id: $m) { mediaListEntry { status progress } } }', { m: ANI_ID }))?.data?.Media?.mediaListEntry
  if (final?.status === 'COMPLETED') break
  await sleep(3000)
}
console.log('final entry:', JSON.stringify(final))
const pass = final?.status === 'COMPLETED' && final?.progress >= 26
console.log('\nTEST-B-autocompleted:', pass ? 'PASS' : 'FAIL')

// cleanup: back to CURRENT/25 so the test is re-runnable
await gqlNode(`mutation ($m: Int, $s: MediaListStatus, $p: Int) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p) { id } }`, { m: ANI_ID, s: 'CURRENT', p: 25 })
console.log('cleanup: reset to CURRENT/25')
process.exit(pass ? 0 : 1)
