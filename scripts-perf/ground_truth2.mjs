// Ground truth with a playing stream: navigate, wait for video, dump
// native-res (no smoothing) edge bright-fraction stats + geometry.
import WebSocket from 'ws'
import fs from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function session() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.on('open', r))
  let rid = 0
  const evalOn = (expr) => new Promise((res, rej) => {
    const id = ++rid
    const to = setTimeout(() => rej(new Error('eval timeout')), 8000)
    const onMsg = (raw) => {
      const m = JSON.parse(raw)
      if (m.id === id) { ws.off('message', onMsg); clearTimeout(to); m.result?.result ? res(m.result.result.value) : rej(new Error('eval err')) }
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }))
  })
  return { ws, page, evalOn }
}

let { ws, page, evalOn } = await session()
console.log('url:', page.url)
if (!page.url.includes('/watch/')) {
  await evalOn(`location.href = 'http://localhost:5173/watch/5114?ep=34'`).catch(() => {})
  await sleep(12000)
  ws.close()
  ;({ ws, page, evalOn } = await session())
  console.log('url now:', page.url)
}

// Wait for playback up to 60s.
let playing = false
for (let i = 0; i < 60; i++) {
  try {
    const st = await evalOn(`(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, paused: v.paused, w: v.videoWidth } : null })()`)
    if (st && st.ready >= 2 && !st.paused && st.w > 0) { playing = true; console.log('playing', JSON.stringify(st)); break }
  } catch {}
  await sleep(1000)
}
if (!playing) { console.log('NO PLAYBACK'); ws.close(); process.exit(1) }

// Collect edge stats every 2s for 20s — the detector needs ~4s of stable
// bars, so if it would ever misfire on this stream, we'll see it here.
const readings = []
for (let i = 0; i < 10; i++) {
  try {
    const s = await evalOn(`(() => {
      const v = document.querySelector('video'); if (!v) return null
      const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
      const SW = Math.max(64, Math.floor(v.videoWidth / 4)), SH = Math.max(36, Math.floor(v.videoHeight / 4))
      const c = document.createElement('canvas'); c.width = SW; c.height = SH
      const x = c.getContext('2d', { willReadFrequently: true })
      x.imageSmoothingEnabled = false
      x.drawImage(v, 0, 0, SW, SH)
      const d = x.getImageData(0, 0, SW, H = SH).data
      const lum = (i) => 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]
      const brightFrac = (col) => { let n = 0; for (let y = 0; y < SH; y++) if (lum((y*SW+col)*4) > 26) n++; return n/SH }
      const left6 = [], right6 = []
      for (let col = 0; col < 6; col++) { left6.push(+brightFrac(col).toFixed(2)); right6.push(+brightFrac(SW-1-col).toFixed(2)) }
      return { t: +v.currentTime.toFixed(0), box: wrap.style.aspectRatio, vW: v.style.width || '-', vL: v.style.left || '-', fit: getComputedStyle(v).objectFit, left6, right6 }
    })()`)
    if (s) readings.push(s)
  } catch (e) { console.log('read skip:', e.message) }
  await sleep(2000)
}
for (const s of readings) console.log(JSON.stringify(s))
const anyCrop = readings.some((s) => s.vW !== '-')
console.log('--- crop/zoom ever applied:', anyCrop)
try {
  const shot = await evalOn(`(() => { const v=document.querySelector('video'); const r=v.closest('[style*="aspect-ratio"]').getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height}) })()`)
  // screenshot via separate raw CDP call
  const clip = JSON.parse(shot)
  const msg = await new Promise((res) => {
    const id = ++rid
    ws.once('message', function onMsg(raw) {
      const m = JSON.parse(raw)
      if (m.id === id) { ws.off('message', onMsg); res(m.result?.result?.data) }
    })
    ws.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: { format: 'png', clip: { ...clip, scale: 1 } } }))
  })
  if (msg) { fs.writeFileSync('screenshots/ground-truth-player.png', Buffer.from(msg, 'base64')); console.log('saved screenshots/ground-truth-player.png') }
} catch (e) { console.log('shot skip:', e.message) }
ws.close()
process.exit(0)
