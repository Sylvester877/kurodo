// DL probe: does the active hls.js level's decoded width exceed the stream's
// coded width (e.g. 1920 coded in 1918 container)? Check via hls.js if
// exposed, else compare videoWidth with the manifest's RESOLUTION.
import WebSocket from 'ws'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
await new Promise((r) => ws.on('open', r))
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

const info = await evalJS(`(() => {
  const v = document.querySelector('div[class*="group relative"] video')
  if (!v) return { err: 'no video' }
  // hls.js is usually attached via a property or module scope; try common hooks
  const hls = v._hls || window.hls || (v.hls)
  const out = {
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    src0: (v.currentSrc || '').slice(0, 90),
  }
  if (hls) {
    const lv = hls.levels?.[hls.currentLevel ?? hls.loadLevel] || hls.levels?.[0]
    out.level = lv ? { width: lv.width, height: lv.height, attrs: lv.attrs && lv.attrs.RESOLUTION } : null
    out.levels = (hls.levels || []).map(l => l.width + 'x' + l.height)
  } else {
    out.hls = 'not-exposed'
  }
  return out
})()`)
console.log(JSON.stringify(info, null, 1))
