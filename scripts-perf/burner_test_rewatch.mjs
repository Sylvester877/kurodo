// Test F — re-watch (REPEATING) flow:
//   0. Guard: Gre0dy.
//   1. Setup: Cowboy Bebop (MAL 1 / AniList 1) on AniList as REPEATING, progress 5.
//   2. Open /watch/1?ep=6 in the real player, seek near end (fires the
//      near-end auto-mark → syncProgress(1, 6)).
//   3. Verify: status REMAINS REPEATING (not downgraded to CURRENT) and
//      progress advanced to >= 6.
// This pins the documented behavior: "existing entry is COMPLETED/REPEATING/
// DROPPED/PAUSED → leave its status alone; the user may be re-watching."
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173'
const GRAPHQL = 'https://graphql.anilist.co'
const MAL_ID = 1
const ANI_ID = 1
const REWATCH_EP = 6

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
// fixes: a second live app tab clobbers the persisted watchlist store
//        (last-writer-wins localStorage). Close every tab except one app
//        page, then drive only that.
const pages = await browser.pages()
for (const p of pages.slice(1)) { try { await p.close() } catch {} }
let page = (await browser.pages()).find((p) => (p.url() || '').includes('localhost:5173'))
  ?? (await browser.pages())[0]
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(4000)

const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
// fixes: Viewer 429s under test load — retry with backoff instead of aborting.
let who = null
for (let i = 0; i < 5 && who !== 'Gre0dy'; i++) {
  who = (await (await fetch(GRAPHQL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ query: 'query { Viewer { name } }' }) })).json())?.data?.Viewer?.name
  if (who !== 'Gre0dy') { console.log(`guard retry ${i + 1} (got ${who})`); await sleep(20000) }
}
if (who !== 'Gre0dy') { console.error('ABORT —', who); process.exit(1) }
console.log('guard: Gre0dy ✓')

const gqlNode = async (query, variables) => (await fetch(GRAPHQL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query, variables }),
})).json()

// 0. PRE-CLEAN the local watched list for MAL 1. Two poisons from earlier
//    runs: (a) ep 6 already marked → near-end early-returns, no re-sync;
//    (b) stale ep 26 → markEpisodeWatched mirrors the HIGHEST watched ep,
//    so any new mark would re-sync the finale (COMPLETED flip).
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('kurodo-watchlist') || '{}')
  if (raw?.state?.watchedEpisodes) { delete raw.state.watchedEpisodes['1']; localStorage.setItem('kurodo-watchlist', JSON.stringify(raw)) }
})
// fixes: deleting from localStorage AFTER hydration is a no-op — the zustand
//        store holds the old state in memory and re-persists it. Reload so
//        the store re-hydrates from the CLEANED localStorage.
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(5000)

// 1. Setup: REPEATING progress 5
let ok = false
for (let i = 0; i < 5 && !ok; i++) {
  const j = await gqlNode(`mutation ($m: Int, $s: MediaListStatus, $p: Int) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p) { id status progress } }`, { m: ANI_ID, s: 'REPEATING', p: 5 })
  ok = j?.data?.SaveMediaListEntry?.status === 'REPEATING'
  if (!ok) await sleep(2500)
}
if (!ok) { console.error('SETUP FAILED'); process.exit(1) }
console.log('setup: Bebop REPEATING/5')

// 2. Play ep 6, seek near end.
// fixes: the player iframe can pop out to a top-level tab (aniembed.se) and
//        reorder CDP targets — ALWAYS re-find the app page by URL and drive
//        THAT, never pages[0].
await page.goto(`${ORIGIN}/watch/${MAL_ID}?ep=${REWATCH_EP}`, { waitUntil: 'domcontentloaded' })
await sleep(5000)
// fixes: navigating during app boot gets swallowed by the app's own URL
//        normalization — the page lands back on '/'. Verify we actually got
//        to /watch and re-navigate (up to 3x) if not.
for (let i = 0; i < 3; i++) {
  const u = await page.url()
  if (u.includes('/watch/')) break
  console.log('redirected to', u, '— retrying watch nav')
  await page.goto(`${ORIGIN}/watch/${MAL_ID}?ep=${REWATCH_EP}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await sleep(6000)
}
const page0 = page
const ev = async (fn) => {
  // Always evaluate on the CURRENT app page (iframe popouts reorder targets).
  const p = ((await browser.pages()).find((x) => (x.url() || '').includes('localhost:5173/watch'))) ?? page0
  for (let i = 0; i < 5; i++) {
    try { return await p.evaluate(fn) } catch (e) {
      // fixes: "Attempted to use detached Frame" — the app full-navigates when
      //        it normalizes the URL (?lang=dub&autoplay=1) mid-test; treat it
      //        like a context destruction and retry on the fresh frame.
      if (!/context was destroyed|navigat|detached/i.test(e.message)) throw e
      await sleep(2000)
    }
  }
  return null
}
let ready = false
for (let i = 0; i < 60 && !ready; i++) {
  ready = (await ev(() => { const v = document.querySelector('video'); return !!v && v.readyState >= 2 && v.duration > 0 })) === true
  if (!ready) await sleep(1000)
}
// fixes: the auto-picked server may be an IFRAME EMBED (aniembed.se — the
//        video is cross-origin, so the app cannot see timeupdate/near-end and
//        auto-mark can NEVER fire). Pin a direct-stream server (gogo family —
//        avoid the known embed names) before judging the mark flow.
const src = await ev(() => document.querySelector('video')?.currentSrc || '')
if (!src || /aniembed\.se/.test(src)) {
  console.log('embed/absent stream (' + (src || 'none').slice(0, 50) + ') — pinning direct server')
  await ev(() => {
    const tiles = [...document.querySelectorAll('button[title^="Play on"]')]
    const embed = /sora|kiwi|neko|beep|aniembed/i
    const pick = tiles.find((t) => !embed.test(t.title)) ?? tiles[0]
    if (pick) pick.click()
    return pick?.title ?? 'NO_TILE'
  })
  ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    ready = (await ev(() => { const v = document.querySelector('video'); return !!v && v.readyState >= 2 && v.duration > 0 })) === true
    if (!ready) await sleep(1000)
  }
}
const src2 = await ev(() => document.querySelector('video')?.currentSrc || '')
console.log('stream src:', (src2 || 'none').slice(0, 70))
console.log('video_ready:', ready)
if (!ready) process.exit(1)
await ev(() => {
  const v = document.querySelector('video')
  v.muted = true
  v.playbackRate = 4
  v.currentTime = Math.max(0, v.duration - 25)
  v.play().catch(() => {})
  return true
})
console.log('seek near end — waiting…')

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
await sleep(8000)
// diagnostics: did the mark land in the local store?
const watched = await ev(() => {
  try { return JSON.parse(localStorage.getItem('kurodo-watchlist') || '{}')?.state?.watchedEpisodes?.['1'] ?? null } catch { return null }
})
console.log('local watched eps for MAL 1:', JSON.stringify(watched))

// Re-find the APP page (the player iframe may have opened its own target).
const appPage = (await browser.pages()).find((p) => (p.url() || '').includes('localhost:5173'))
if (!appPage) { console.error('NO_APP_PAGE'); process.exit(1) }
// drive the re-found app page from here on
page = appPage
// 3. Verify: REPEATING preserved, progress >= 6
let final = null
let pass = false
for (let i = 0; i < 8; i++) {
  final = (await gqlNode('query ($m: Int) { Media(id: $m) { mediaListEntry { status progress } } }', { m: ANI_ID }))?.data?.Media?.mediaListEntry
  if (final?.status === 'REPEATING' && (final?.progress ?? 0) >= REWATCH_EP) { pass = true; break }
  await sleep(3000)
}
console.log('final entry:', JSON.stringify(final))
console.log('\nTEST-F-rewatch:', pass ? 'PASS' : 'FAIL',
  pass ? '(status preserved REPEATING, progress advanced)'
       : `(status ${final?.status}, progress ${final?.progress})`)

// cleanup: back to CURRENT/25 for the auto-completed test's baseline
await gqlNode(`mutation ($m: Int, $s: MediaListStatus, $p: Int) { SaveMediaListEntry(mediaId: $m, status: $s, progress: $p) { id } }`, { m: ANI_ID, s: 'CURRENT', p: 25 })
console.log('cleanup: reset to CURRENT/25')
process.exit(pass ? 0 : 1)
