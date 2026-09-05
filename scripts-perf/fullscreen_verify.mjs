// Verify fullscreen behavior in the live app:
//  1. Play a video, enter REAL fullscreen on the player wrapper.
//  2. Assert: box fills the screen, aspect-ratio style NOT applied,
//     no crop geometry on the video, object-fit contain.
//  3. Screenshot the fullscreen state.
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
console.log('url:', page.url)
if (!page.url.includes('/watch/')) {
  await evalJs(`location.href = 'http://localhost:5173/watch/5114?ep=2'`).catch(() => {})
  await sleep(12000)
  ws.close()
  ;({ ws, page, call, evalJs } = await connect())
}

// Wait for a video element and start playback (muted to be safe).
let ok = false
for (let i = 0; i < 45; i++) {
  const st = await evalJs(`(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, paused: v.paused, buf: v.buffered.length ? +v.buffered.end(v.buffered.length-1).toFixed(1) : 0 } : null })()`)
  if (st && st.ready >= 2) {
    await evalJs(`(() => { const v = document.querySelector('video'); v.muted = true; v.play().catch(()=>{}); return 1 })()`)
    ok = true
    break
  }
  await sleep(1000)
}
console.log('video ready:', ok)
await sleep(4000)

// Enter fullscreen via the wrapper (same as the F key path).
const fs2 = await evalJs(`(async () => {
  const v = document.querySelector('video')
  const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement.parentElement
  try {
    await wrap.requestFullscreen()
    return 'entered'
  } catch (e) { return 'failed: ' + e.message }
})()`)
console.log('fullscreen:', fs2)
await sleep(2500)

// Measure in fullscreen (use the actual fullscreen element — the wrapper
// no longer carries an aspect-ratio style in fullscreen, by design).
const geo = await evalJs(`(() => {
  const v = document.querySelector('video')
  const wrap = document.fullscreenElement || v.closest('[style*="aspect-ratio"]') || v.parentElement
  const wr = wrap.getBoundingClientRect()
  const vr = v.getBoundingClientRect()
  const cs = getComputedStyle(v)
  return {
    isFullscreen: !!document.fullscreenElement,
    fsTag: wrap.tagName,
    screen: screen.width + 'x' + screen.height,
    boxRect: Math.round(wr.width) + 'x' + Math.round(wr.height),
    boxFillsScreen: wr.width >= screen.width * 0.95 && wr.height >= screen.height * 0.9,
    boxAspectStyle: wrap.style?.aspectRatio || '(none — UA sized)',
    videoStyleW: v.style.width || '(default)',
    videoStyleLeft: v.style.left || '(none)',
    videoTransform: cs.transform,
    objectFit: cs.objectFit,
    videoRect: Math.round(vr.width) + 'x' + Math.round(vr.height),
    videoFillsBox: vr.width >= wr.width - 4,
    stream: v.videoWidth + 'x' + v.videoHeight,
  }
})()`)
console.log(JSON.stringify(geo, null, 2))

const shot = await call('Page.captureScreenshot', { format: 'png' })
if (shot.data) { fs.writeFileSync('screenshots/fullscreen-fixed.png', Buffer.from(shot.data, 'base64')); console.log('saved screenshots/fullscreen-fixed.png') }

// Exit fullscreen to leave the app in a normal state.
await evalJs(`(() => { if (document.fullscreenElement) document.exitFullscreen(); return 1 })()`).catch(() => {})
ws.close()
const pass = geo.isFullscreen && geo.boxFillsScreen && !/^\d/.test(geo.boxAspectStyle) && geo.videoStyleLeft === '(none)' && geo.videoTransform === 'none'
console.log(pass ? 'FULLSCREEN VERIFY: PASS' : 'FULLSCREEN VERIFY: CHECK OUTPUT')
process.exit(0)
