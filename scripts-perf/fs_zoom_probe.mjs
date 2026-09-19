// Zoom probe: read the wrapper's --fs-zoom and the video's live transform
// mid-fullscreen, plus re-measure with sub-pixel precision. A uniform
// scale CAN'T clip one side only — unless transform-origin isn't center.
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
await send('Runtime.enable')
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) { console.log('[exc]', (r.result.exceptionDetails?.exception?.description || '').slice(0, 150)); return null }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// enter fullscreen
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); if (w && !document.fullscreenElement) w.requestFullscreen(); return 'ok' })()`)
await sleep(2200)

const probe = await evalJS(`(() => {
  const wrap = document.querySelector('div[class*="group relative"]')
  const v = wrap?.querySelector('video')
  if (!wrap || !v) return { err: 'missing' }
  const wStyle = getComputedStyle(wrap)
  const vStyle = getComputedStyle(v)
  const vr = v.getBoundingClientRect()
  return {
    fsZoomVar: wStyle.getPropertyValue('--fs-zoom'),
    inlineStyleAttr: wrap.getAttribute('style'),
    videoInline: v.getAttribute('style'),
    transform: vStyle.transform,
    transformOrigin: vStyle.transformOrigin,
    videoRectPrecise: { l: vr.left, r: vr.right, w: vr.width, t: vr.top, b: vr.bottom, h: vr.height },
    innerW: window.innerWidth,
    devicePixelRatio: window.devicePixelRatio,
    objFit: vStyle.objectFit,
    objectPosition: vStyle.objectPosition,
  }
})()`)
console.log(JSON.stringify(probe, null, 1))
process.exit(0)
