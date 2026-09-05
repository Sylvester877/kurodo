// Revive playback: seek into buffered range; if that fails, full reload
// (fresh stream session); then capture 3 shots with time-advance proof.
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

const advanceCheck = async (evalJs) => {
  const a = await evalJs(`(() => +document.querySelector('video')?.currentTime.toFixed(1))()`)
  await sleep(4000)
  const b2 = await evalJs(`(() => +document.querySelector('video')?.currentTime.toFixed(1))()`)
  return { advancing: b2 > a + 2, from: a, to: b2 }
}

let { ws, page, call, evalJs } = await connect()

// Attempt 1: seek into the buffered range and play.
await evalJs(`(() => { const v = document.querySelector('video'); if (v && v.buffered.length) { v.currentTime = v.buffered.start(0) + 0.5; v.play().catch(()=>{}) } return 1 })()`)
await sleep(5000)
let chk = await advanceCheck(evalJs)
console.log('seek-into-buffer:', JSON.stringify(chk))

// Attempt 2: full reload for a fresh stream session.
if (!chk.advancing) {
  console.log('reloading for fresh stream…')
  await evalJs(`location.reload()`).catch(() => {})
  await sleep(15000)
  ws.close()
  ;({ ws, page, call, evalJs } = await connect())
  await evalJs(`(() => { const v = document.querySelector('video'); if (v) v.play().catch(()=>{}); return 1 })()`).catch(() => {})
  await sleep(8000)
  chk = await advanceCheck(evalJs)
  console.log('after reload:', JSON.stringify(chk))
}

// Attempt 3: seek to 30s (fresh territory) once data flows.
if (chk.advancing) {
  await evalJs(`(() => { const v = document.querySelector('video'); v.currentTime = 30; return 1 })()`)
  await sleep(6000)
  chk = await advanceCheck(evalJs)
  console.log('after seek-to-30:', JSON.stringify(chk))
}

// 3 shots 6s apart with per-shot timestamp.
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
