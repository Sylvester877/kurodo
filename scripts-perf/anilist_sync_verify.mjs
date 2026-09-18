// Verify the AniList sync chain end-to-end in the real Electron window:
//  1. Confirm auth state (signed in or not) in the page's localStorage.
//  2. Open a watch page, play, then seek the video to >90% (within last 2min)
//     so the near-end trigger fires — exactly like a real finish.
//  3. Observe: in-app "watched" mark, AniList SaveMediaListEntry network
//     call (if signed in) or the pending-sync queue entry (if signed out).
//  4. Screenshot proof.
import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9222, path: pathname, timeout: 3000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
}

const list = await getJson('/json/list')
const page = list.find((t) => t.type === 'page')
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

let msgId = 0
const pending = new Map()
const anilistCalls = []
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') {
    const req = m.params.request
    if (req.url.includes('graphql.anilist.co') || (req.postData || '').includes('SaveMediaListEntry')) {
      anilistCalls.push({ url: req.url.slice(0, 80), body: (req.postData || '').slice(0, 200) })
    }
  }
})
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

// ── 1. Auth state ──
const auth = await evalJs(`(() => {
  try {
    const raw = localStorage.getItem('kurodo-anilist-auth')
    if (!raw) return { signedIn: false }
    const a = JSON.parse(raw)
    return { signedIn: true, user: a.user?.name || '(unknown)', hasToken: !!a.token }
  } catch { return { signedIn: false, parseError: true } }
})()`)
console.log('auth state:', JSON.stringify(auth))

// ── 2. Navigate to watch page (FMA:B ep 1 — fresh episode key) ──
// Use a fresh ep to guarantee the mark-watched hasn't fired before.
await send('Page.navigate', { url: 'http://localhost:5173/watch/5114?ep=1' })
await sleep(15000)

const preState = await evalJs(`(() => {
  const video = document.querySelector('video')
  const watchedKey = Object.keys(localStorage).find(k => k.includes('watched') || k.includes('watchlist'))
  return {
    hasVideo: !!video,
    readyState: video?.readyState,
    paused: video?.paused,
    duration: video?.duration ?? null,
    ep: new URLSearchParams(location.search).get('ep'),
  }
})()`)
console.log('pre-seek:', JSON.stringify(preState))
if (!preState.hasVideo) { console.log('NO VIDEO — cannot continue'); ws.close(); process.exit(1) }

// ── 3. Seek past 90%, within last 2 minutes ──
const seekResult = await evalJs(`(async () => {
  const v = document.querySelector('video')
  if (!v || !isFinite(v.duration) || v.duration <= 30) return { error: 'video not ready', duration: v?.duration }
  try { v.muted = true } catch {}
  const target = v.duration - Math.min(60, v.duration * 0.05) // 95%
  v.currentTime = target
  try { await v.play() } catch (e) { return { error: 'play failed: ' + e.message, target } }
  return { target, duration: v.duration }
})()`)
console.log('seek:', JSON.stringify(seekResult))

// Wait for the near-end trigger + sync round trip
await sleep(12000)

// ── 4. Observe outcomes ──
const post = await evalJs(`(() => {
  const video = document.querySelector('video')
  const raw = localStorage.getItem('kurodo-anilist-watchlist')
  let watchedEp1 = null
  try {
    const wl = JSON.parse(raw || '{}')
    // watchedEpisodes: { [malId]: number[] }
    for (const k of Object.keys(wl.watchedEpisodes || {})) {
      const arr = wl.watchedEpisodes[k]
      if (Array.isArray(arr) && arr.includes(1)) { watchedEp1 = { malId: k } ; break }
    }
  } catch {}
  return {
    time: video ? Math.round(video.currentTime) : null,
    duration: video?.duration ? Math.round(video.duration) : null,
    ended: video?.ended ?? null,
    inAppWatched: watchedEp1,
    pendingQueue: localStorage.getItem('kurodo-pending-anilist-progress'),
    activityBufferNote: 'activity flushes on its own timer',
  }
})()`)
console.log('post-seek:', JSON.stringify(post, null, 2))

console.log(`\nAniList graphql requests observed: ${anilistCalls.length}`)
for (const c of anilistCalls.slice(0, 5)) {
  const isSave = c.body.includes('SaveMediaListEntry')
  console.log(`  ${isSave ? '★ SaveMediaListEntry' : '  other query'}: ${c.body.slice(0, 110)}`)
}

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'anilist-sync-verify.png'), Buffer.from(shot.result.data, 'base64'))

// Verdicts
const markFired = !!post.inAppWatched
const syncedOrQueued = anilistCalls.some((c) => c.body.includes('SaveMediaListEntry')) || !!post.pendingQueue
console.log(`\nIN-APP AUTO-MARK: ${markFired ? 'PASS ✓' : 'FAIL'}`)
console.log(`ANILIST SYNC ${auth.signedIn ? '(signed in)' : '(signed out → queued)'}: ${syncedOrQueued ? 'PASS ✓' : 'FAIL'}`)
ws.close()
process.exit(markFired && syncedOrQueued ? 0 : 1)
