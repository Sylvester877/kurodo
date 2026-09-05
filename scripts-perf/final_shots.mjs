// Patient version: wait up to 3 min for healthy playback, then 3 shots.
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

// Poll for up to 180s: video playing AND buffer comfortably ahead.
let healthy = false
for (let i = 0; i < 60; i++) {
  const st = await evalJs(`(() => { const v = document.querySelector('video'); if (!v) return null; return { ready: v.readyState, paused: v.paused, t: +v.currentTime.toFixed(1), buf: v.buffered.length ? +v.buffered.end(v.buffered.length-1).toFixed(1) : 0 } })()`).catch(() => null)
  if (st && st.ready >= 3 && !st.paused && st.buf > st.t + 10) {
    // Confirm time actually advances over 3s.
    const a = await evalJs(`(() => +document.querySelector('video').currentTime.toFixed(1))()`)
    await sleep(3000)
    const b2 = await evalJs(`(() => +document.querySelector('video').currentTime.toFixed(1))()`)
    if (b2 > a + 2) { console.log('healthy at t=' + a, 'buf=' + st.buf); healthy = true; break }
  }
  if (i % 6 === 0) console.log('waiting…', JSON.stringify(st))
  // Nudge play every ~15s in case autoplay was blocked.
  if (i > 0 && i % 6 === 0) await evalJs(`(() => { const v = document.querySelector('video'); if (v && v.paused) v.play().catch(()=>{}); return 1 })()`).catch(() => {})
  await sleep(3000)
}
console.log('healthy:', healthy)

// Screenshots regardless, with time proof (paused frame is still proof of
// the fixed geometry, but playing frames are better).
for (let n = 1; n <= 3; n++) {
  try {
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
  } catch (e) { console.log('shot', n, 'failed:', e.message) }
  await sleep(6000)
}
ws.close()
process.exit(0)
