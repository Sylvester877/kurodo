// Check what state the player is in, dismiss overlays, seek to 60s, play.
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
const state = await evalJs(`(() => {
  const v = document.querySelector('video')
  return {
    hasVideo: !!v,
    paused: v?.paused, ended: v?.ended, ready: v?.readyState,
    t: v ? +v.currentTime.toFixed(0) : null, dur: v ? +v.duration.toFixed(0) : null,
    bodyText: document.body.innerText.slice(0, 300).replace(/\\n/g, ' | '),
  }
})()`)
console.log(JSON.stringify(state, null, 2))

if (state.hasVideo) {
  // Seek away from the very end and play.
  const r = await evalJs(`(async () => {
    const v = document.querySelector('video')
    v.muted = true
    v.currentTime = 60
    try { await v.play() } catch (e) { return 'play failed: ' + e.message }
    return 'playing'
  })()`)
  console.log('seek+play:', r)
  await sleep(4000)
  const after = await evalJs(`(() => { const v = document.querySelector('video'); return { t: +v.currentTime.toFixed(0), paused: v.paused } })()`)
  console.log('after:', JSON.stringify(after))

  // Geometry + 3 screenshots 6s apart.
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
}
ws.close()
process.exit(0)
