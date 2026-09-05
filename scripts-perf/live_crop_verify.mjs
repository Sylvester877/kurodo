// Live verification: reload the window onto the fresh build, navigate to a
// watch page, wait for a playing <video>, then measure the new geometry and
// screenshot the player region.
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expr, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })
  if (r.result?.exceptionDetails) console.log('page error:', r.result.exceptionDetails.text)
  return r.result?.result?.value ?? null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await new Promise((r) => ws.on('open', r))

// Fresh load of the new bundle.
await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(6000)

// Navigate to a watch page.
await evalJs(`location.href = 'http://localhost:5173/watch/5114?ep=2'`)
await sleep(8000)

// Wait until a video exists and is playing (up to 45s).
let has = false
for (let i = 0; i < 45; i++) {
  const st = await evalJs(`(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, paused: v.paused, w: v.videoWidth, h: v.videoHeight, t: v.currentTime } : null })()`)
  if (st && st.ready >= 2 && !st.paused && st.w > 0) { console.log('playing:', JSON.stringify(st)); has = true; break }
  await sleep(1000)
}
if (!has) { console.log('video never played'); await send('Page.captureScreenshot', { format: 'png' }).then(async s => { if (s.result?.data) { fs.writeFileSync('screenshots/live-crop-stuck.png', Buffer.from(s.result.data, 'base64')); console.log('saved stuck screenshot') } }); process.exit(1) }

// Give the detector up to ~8s to measure frames, then read geometry.
await sleep(8000)
const geo = await evalJs(`(() => {
  const v = document.querySelector('video')
  const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
  const wr = wrap.getBoundingClientRect()
  const vr = v.getBoundingClientRect()
  const cs = getComputedStyle(v)
  return {
    stream: v.videoWidth + 'x' + v.videoHeight,
    streamAspect: +(v.videoWidth / v.videoHeight).toFixed(4),
    wrapAspectCss: wrap.style.aspectRatio,
    wrapRect: Math.round(wr.width) + 'x' + Math.round(wr.height),
    wrapAspectActual: +(wr.width / wr.height).toFixed(4),
    videoTransform: cs.transform,
    videoWidthStyle: v.style.width || '(default 100%)',
    videoLeftStyle: v.style.left || '(none)',
    objectFit: cs.objectFit,
    videoRect: Math.round(vr.width) + 'x' + Math.round(vr.height),
    videoInsideBox: (vr.left >= wr.left - 2 && vr.right <= wr.right + 2 && vr.top >= wr.top - 2 && vr.bottom <= wr.bottom + 2),
  }
})()`)
console.log(JSON.stringify(geo, null, 2))

// Screenshot the player box.
const rect = await evalJs(`(() => { const r = document.querySelector('video').closest('[style*="aspect-ratio"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } })
if (shot.result?.data) { fs.writeFileSync('screenshots/live-crop-player.png', Buffer.from(shot.result.data, 'base64')); console.log('saved screenshots/live-crop-player.png') }
ws.close()
process.exit(0)
