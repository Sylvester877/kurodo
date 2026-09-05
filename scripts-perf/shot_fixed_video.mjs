// Screenshot the fixed video: ensure playback, wait past the detector's
// 12s window, capture 3 frames a few seconds apart + geometry check.
import WebSocket from 'ws'
import fs from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.on('open', r))
  let rid = 0
  const call = (method, params = {}) => new Promise((res, rej) => {
    const id = ++rid
    const to = setTimeout(() => rej(new Error('timeout: ' + method)), 8000)
    const onMsg = (raw) => {
      const m = JSON.parse(raw)
      if (m.id === id) { ws.off('message', onMsg); clearTimeout(to); m.result?.result ? res(m.result.result) : rej(new Error('err')) }
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evalJs = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).value
  return { ws, page, call, evalJs }
}

let { ws, page, call, evalJs } = await connect()
console.log('url:', page.url)
if (!page.url.includes('/watch/')) {
  await evalJs(`location.href = 'http://localhost:5173/watch/5114?ep=34'`).catch(() => {})
  await sleep(12000)
  ws.close()
  ;({ ws, page, call, evalJs } = await connect())
}

// Wait for playback.
let playing = false
for (let i = 0; i < 60; i++) {
  const st = await evalJs(`(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, paused: v.paused } : null })()`)
  if (st && st.ready >= 2 && !st.paused) { playing = true; break }
  await sleep(1000)
}
console.log('playing:', playing)
if (!playing) process.exit(1)

// Unmute + ensure controls are hidden for a clean shot.
await evalJs(`(() => { const v = document.querySelector('video'); if (v) { v.muted = true } ; return 'ok' })()`)

// Capture 3 shots, 6s apart, with geometry each time.
for (let n = 1; n <= 3; n++) {
  const geo = await evalJs(`(() => {
    const v = document.querySelector('video')
    const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
    const r = wrap.getBoundingClientRect()
    return JSON.stringify({ t: +v.currentTime.toFixed(0), box: wrap.style.aspectRatio, crop: v.style.width || 'none', rect: { x: r.x, y: r.y, width: r.width, height: r.height } })
  })()`)
  const g = JSON.parse(geo)
  const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...g.rect, scale: 1 } })
  if (shot.data) {
    fs.writeFileSync(`screenshots/fixed-video-${n}.png`, Buffer.from(shot.data, 'base64'))
    console.log(`shot ${n}: t=${g.t}s box=${g.box} crop=${g.crop} -> screenshots/fixed-video-${n}.png`)
  }
  if (n < 3) await sleep(6000)
}
ws.close()
process.exit(0)
