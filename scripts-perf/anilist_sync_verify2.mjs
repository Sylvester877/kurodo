// Definitive AniList sync verification with robust video polling.
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
const saveCalls = []
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') {
    const body = m.params.request.postData || ''
    if (body.includes('SaveMediaListEntry')) saveCalls.push(body.slice(0, 250))
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

// Auth pre-check
const auth = await evalJs(`(() => { try { const a = JSON.parse(localStorage.getItem('kurodo-anilist-auth')||'null'); return a ? { signedIn: true, user: a.user?.name } : { signedIn: false } } catch { return { signedIn: false } } })()`)
console.log('auth:', JSON.stringify(auth))

// Navigate + poll for a ready video (up to 60s)
await send('Page.navigate', { url: 'http://localhost:5173/watch/5114?ep=8' })
let video = null
for (let i = 0; i < 30; i++) {
  await sleep(2000)
  video = await evalJs(`(() => { const v=document.querySelector('video'); return v ? { has:true, dur:v.duration, rs:v.readyState, paused:v.paused } : { has:false } })()`)
  if (video?.has && video.dur > 30) break
}
console.log('video ready:', JSON.stringify(video))
if (!video?.has) { console.log('ABORT: no video'); ws.close(); process.exit(1) }

// Install hooks, then seek to 97.5% and play
const seek = await evalJs(`(async () => {
  const v = document.querySelector('video')
  window.__events = []
  const origSet = localStorage.setItem.bind(localStorage)
  localStorage.setItem = function(k, val) {
    if (k === 'kurodo-watchlist' && (val||'').includes('5114')) window.__events.push('STORE_MARK@' + new Date().toISOString().slice(11,19))
    return origSet(k, val)
  }
  v.addEventListener('ended', () => window.__events.push('VIDEO_ENDED@' + Math.round(v.currentTime)))
  v.muted = true
  v.currentTime = v.duration - 40
  try { await v.play() } catch (e) { return { error: String(e) } }
  return { seekedTo: Math.round(v.currentTime), fromEnd: Math.round(v.duration - v.currentTime), dur: Math.round(v.duration) }
})()`)
console.log('seek:', JSON.stringify(seek))

// Sample playback + dialog presence for 20s
for (let i = 0; i < 5; i++) {
  await sleep(4000)
  const s = await evalJs(`(() => {
    const v = document.querySelector('video')
    const dlg = [...document.querySelectorAll('[role=dialog], .fixed.inset-0.z-\\[90\\], .fixed.inset-0')].find(d => d.offsetParent !== null && (d.textContent||'').length > 0)
    return {
      t: Math.round(v?.currentTime ?? -1),
      ended: v?.ended,
      dialog: dlg ? (dlg.textContent||'').replace(/\\s+/g,' ').slice(0, 80) : null,
      watched: (() => { try { return JSON.parse(localStorage.getItem('kurodo-watchlist')||'{}')?.watchedEpisodes?.['5114'] ?? null } catch { return 'ERR' } })(),
      events: (window.__events || []).slice(-4),
    }
  })()`)
  console.log(`t+${(i + 1) * 4}s:`, JSON.stringify(s))
}

console.log(`\nSaveMediaListEntry calls: ${saveCalls.length}`)
for (const c of saveCalls.slice(0, 3)) console.log('  ★', c.replace(/\s+/g, ' ').slice(0, 160))

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'anilist-sync-final.png'), Buffer.from(shot.result.data, 'base64'))

ws.close()
