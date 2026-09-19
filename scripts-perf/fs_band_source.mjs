// Is the 10px band IN THE SOURCE FRAME? Draw the video to canvas at exactly
// the element size (1536x960 CSS → sample right edge), and also at native
// 1280x720, then compare edge columns.
import WebSocket from 'ws'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page'); process.exit(1) }
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
  if (r.result?.exceptionDetails) { console.log('[exc]', (r.result.exceptionDetails?.exception?.description || '').slice(0, 150)); return null }
  return r.result?.result?.value
}

// fullscreen first
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); if (w && !document.fullscreenElement) w.requestFullscreen(); return 1 })()`)
await new Promise((r) => setTimeout(r, 2000))

const res = await evalJS(`(async () => {
  const v = document.querySelector('div[class*="group relative"] video')
  if (!v) return { err: 'no video' }
  const out = {}
  // native 1280x720 draw
  {
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(v, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    const W = c.width, H = c.height
    const colMax = (x) => { let mx = 0; for (let y = 0; y < H; y += 2) { const i = (y * W + x) * 4; mx = Math.max(mx, d[i], d[i+1], d[i+2]) } return mx }
    let fb = -1
    for (let x = W - 1; x >= W - 30; x--) { if (colMax(x) >= 8) { fb = x + 1; break } }
    out.native = { W, H, rightBlackPx: fb < 0 ? 30 : W - fb }
  }
  // element-size draw (1536x960) — what cover actually renders
  {
    const c = document.createElement('canvas')
    c.width = 1536; c.height = 960
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(v, 0, 0, 1536, 960)
    const d = ctx.getImageData(0, 0, 1536, 960).data
    const W = 1536, H = 960
    const colMax = (x) => { let mx = 0; for (let y = 0; y < H; y += 2) { const i = (y * W + x) * 4; mx = Math.max(mx, d[i], d[i+1], d[i+2]) } return mx }
    let fb = -1
    for (let x = W - 1; x >= W - 30; x--) { if (colMax(x) >= 8) { fb = x + 1; break } }
    out.elSize = { W, H, rightBlackPx: fb < 0 ? 30 : W - fb }
  }
  out.videoWH = { w: v.videoWidth, h: v.videoHeight }
  return out
})()`)
console.log(JSON.stringify(res, null, 1))
process.exit(0)
