// Reload the watch page, wait for autoplay + healthy buffering, capture
// 3 screenshots with time-advance proof between each.
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
    const to = setTimeout(() => rej(new Error('timeout: ' + method)), 12000)
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
await evalJs(`location.href = 'http://localhost:5173/watch/5114?ep=34'`).catch(() => {})
await sleep(12000)
ws.close()
;({ ws, page, call, evalJs } = await connect())

// Wait for playback that truly advances, up to 90s.
let advancing = false
let t1 = 0, t2 = 0
for (let i = 0; i < 30; i++) {
  const st = await evalJs(`(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, paused: v.paused, t: +v.currentTime.toFixed(1), buf: v.buffered.length ? +v.buffered.end(v.buffered.length-1).toFixed(1) : 0 } : null })()`)
  if (st && st.ready >= 2 && !st.paused && st.buf > st.t + 5) {
    t1 = st.t
    await sleep(4000)
    t2 = await evalJs(`(() => +document.querySelector('video').currentTime.toFixed(1))()`)
    if (t2 > t1 + 2) { advancing = true; console.log('healthy:', JSON.stringify(st), `-> ${t2}`); break }
  }
  await sleep(2000)
}
console.log('advancing:', advancing)
if (!advancing) process.exit(1)

// 3 shots 6s apart with per-shot timestamp proof.
for (let n = 1; n <= 3; n++) {
  const ts = await evalJs(`(() => {
    const v = document.querySelector('video')
    const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
    const r = wrap.getBoundingClientRect()
    return JSON.stringify({ t: +v.currentTime.toFixed(1), box: wrap.style.aspectRatio, crop: v.style.width || 'none', rect: { x: Math.max(0,r.x), y: Math.max(0,r.y), width: r.width, height: r.height } })
  })()`)
  const g = JSON.parse(ts)
  const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...g.rect, scale: 1 } })
  if (shot.data) {
    fs.writeFileSync(`screenshots/fixed-video-${n}.png`, Buffer.from(shot.data, 'base64'))
    console.log(`shot ${n}: t=${g.t}s box=${g.box} crop=${g.crop}`)
  }
  await sleep(6000)
}
ws.close()
process.exit(0)
