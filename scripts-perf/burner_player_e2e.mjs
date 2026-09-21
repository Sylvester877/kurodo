// In-player end-to-end sync test (account guard: Gre0dy only).
//   1. Confirm the app's token belongs to Gre0dy (abort otherwise).
//   2. Read Gre0dy's current AniList progress for MAL 21 (One Piece).
//   3. Open /watch/21?ep=2 in the REAL window, play muted, seek near the end
//      (duration-25s) — crosses the app's near-end auto-mark threshold.
//   4. Poll AniList until progress advances to target+1 (max 3 min).
//   5. Observe autonext: did the URL move to ?ep=3 after the episode ended?
// Token is read from the live app and NEVER printed.
import puppeteer from 'puppeteer-core'

const MAL_ID = 21
// fixes: earlier runs navigated 127.0.0.1:5173 — a DIFFERENT origin from the
// app's canonical localhost:5173, so the page had no session token and syncs
// silently queued. Always drive the canonical origin.
const ORIGIN = 'http://localhost:5173'
const EP = Number(process.argv[2]) || 7
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

// ── Guard + baseline ──
const TOKEN = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token ?? null)
if (!TOKEN) { console.error('NO_TOKEN'); process.exit(1) }
async function gql(query, variables) {
  const r = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query, variables }),
  })
  if (r.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 2) * 1000 + 250); return gql(query, variables) }
  const j = await r.json()
  if (j.errors) throw new Error(j.errors[0]?.message ?? 'gql error')
  return j.data
}
const v = await gql(`query { Viewer { name } Media(idMal: ${MAL_ID}, type: ANIME) { id episodes } }`, {})
const who = v.Viewer.name
console.log('token_account:', who)
if (who !== 'Gre0dy') { console.error('ABORT — not Gre0dy. NO WRITES.'); process.exit(1) }
const aniId = v.Media.id
const totalEps = v.Media.episodes
const before = await gql(`query ($id: Int) { MediaListEntry(mediaId: $id) { progress status } }`, { id: aniId }).catch(() => null)
const progBefore = before?.MediaListEntry?.progress ?? 0
console.log(`baseline: aniId=${aniId} progress=${progBefore} totalEps=${totalEps}`)

// ── Drive the real player ──
await page.goto(`${ORIGIN}/watch/${MAL_ID}?ep=${EP}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
// Wait for a playable <video>.
let videoOk = false
for (let i = 0; i < 90 && !videoOk; i++) {
  videoOk = await page.evaluate(() => {
    const el = document.querySelector('video')
    return !!el && el.readyState >= 2
  })
  if (!videoOk) await sleep(1500)
}
console.log('video_ready:', videoOk)
if (!videoOk) { console.error('VERDICT: BLOCKED — no playable video (server/source issue), sync untested'); process.exit(0) }

await page.evaluate(() => {
  const el = document.querySelector('video')
  el.muted = true
  el.play?.().catch(() => {})
})
await sleep(2500)
await page.evaluate(() => {
  const el = document.querySelector('video')
  const d = el.duration
  if (Number.isFinite(d) && d > 60) el.currentTime = Math.max(0, d - 25) // near-end threshold
})
// Play out the final seconds at 4x where the element allows it.
await page.evaluate(() => { const el = document.querySelector('video'); try { el.playbackRate = 4 } catch {} })
console.log('seeking near end…')
// Wait for the video to end (max 90s).
let ended = false
for (let i = 0; i < 60 && !ended; i++) {
  ended = await page.evaluate(() => { const el = document.querySelector('video'); return !!el && el.ended })
  if (!ended) await sleep(1500)
}
console.log('video_ended:', ended)

// ── Poll AniList for the progress bump (the app syncs at ≥90% / on end) ──
const expected = Math.max(progBefore, EP)
let synced = false
let lastSeen = progBefore
for (let i = 0; i < 36 && !synced; i++) {
  await sleep(5000)
  const now = await gql(`query ($id: Int) { MediaListEntry(mediaId: $id) { progress status } }`, { id: aniId }).catch(() => null)
  lastSeen = now?.MediaListEntry?.progress ?? lastSeen
  if ((now?.MediaListEntry?.progress ?? 0) >= expected) synced = true
}
console.log(`anilist_progress: ${progBefore} → ${lastSeen} (expected >= ${expected})`)

// ── Autonext observation ──
const urlNow = page.url()
const moved = /[?&]ep=3/.test(urlNow)
console.log('autonext_url:', urlNow.split('?')[1] ?? '', '→ moved_to_next:', moved)
await page.screenshot({ path: 'screenshots/burner-e2e-final.png' })
browser.disconnect()

console.log('VERDICT:', synced ? (moved ? 'PASS — sync + autonext both worked' : 'PASS (sync) / CHECK (autonext)') : 'FAIL — progress did not reach AniList')
process.exit(0)
