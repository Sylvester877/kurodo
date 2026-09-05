// Diagnose the stalled video, get it truly playing, then take screenshots
// PROVEN distinct (video time must advance between shots).
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
    const to = setTimeout(() => rej(new Error('timeout: ' + method)), 10000)
    const onMsg = (raw) => {
      const m = JSON.parse(raw)
      if (m.id === id) { ws.off('message', onMsg); clearTimeout(to); m.result ? res(m.result) : rej(new Error(JSON.stringify(m.error || 'err'))) }
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evalJs = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
  return { ws, page, call, evalJs }
}

let { ws, page, call, evalJs } = await connect()

// Full video health check.
const health = await evalJs(`(() => {
  const v = document.querySelector('video')
  if (!v) return null
  return {
    t: +v.currentTime.toFixed(1), paused: v.paused, ready: v.readyState,
    network: v.networkState, bufferedEnd: v.buffered.length ? +v.buffered.end(v.buffered.length - 1).toFixed(1) : 0,
    src: (v.currentSrc || '').slice(0, 80),
  }
})()`)
console.log('health:', JSON.stringify(health))

// Nudge: play, and if time doesn't advance, re-toggle.
await evalJs(`(() => { const v = document.querySelector('video'); v.muted = true; v.play().catch(() => {}); return 1 })()`)
await sleep(3000)
let now = await evalJs(`(() => { const v = document.querySelector('video'); return +v.currentTime.toFixed(1) })()`)
console.log('t after nudge:', now)
if (now === health.t) {
  await evalJs(`(() => { const v = document.querySelector('video'); v.pause(); setTimeout(() => v.play().catch(()=>{}), 300); return 1 })()`)
  await sleep(4000)
  now = await evalJs(`(() => { const v = document.querySelector('video'); return +v.currentTime.toFixed(1) })()`)
  console.log('t after toggle:', now)
}

// Wait until time genuinely advances across a 3s gap (up to 40s).
let t1 = await evalJs(`(() => +document.querySelector('video').currentTime.toFixed(1))()`)
let t2 = t1
for (let i = 0; i < 20; i++) {
  await sleep(3000)
  t2 = await evalJs(`(() => +document.querySelector('video').currentTime.toFixed(1))()`)
  if (t2 > t1 + 1.5) break
  console.log('waiting for playback... t=' + t2)
}
console.log('playback advancing:', t2 > t1, `(${t1} -> ${t2})`)

// Three shots, each with a time-stamp proof of a distinct frame.
for (let n = 1; n <= 3; n++) {
  const ts = await evalJs(`(() => {
    const v = document.querySelector('video')
    const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
    const r = wrap.getBoundingClientRect()
    return JSON.stringify({ t: +v.currentTime.toFixed(1), box: wrap.style.aspectRatio, crop: v.style.width || 'none', rect: { x: r.x, y: r.y, width: r.width, height: r.height } })
  })()`)
  const g = JSON.parse(ts)
  const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...g.rect, scale: 1 } })
  if (shot.data) {
    fs.writeFileSync(`screenshots/fixed-video-${n}.png`, Buffer.from(shot.data, 'base64'))
    console.log(`shot ${n}: t=${g.t}s box=${g.box} crop=${g.crop}`)
  }
  await sleep(5000)
}
ws.close()
process.exit(0)
