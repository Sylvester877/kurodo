// Live-pixel probe: with fullscreen active, draw the <video> to a canvas
// INSIDE the page and find the real picture bounds in intrinsic pixels.
// Distinguishes "source has baked bars" from "layout shifts the element".
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
  if (r.result?.exceptionDetails) { console.log('[exc]', (r.result.exceptionDetails?.exception?.description || '').slice(0, 160)); return null }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Enter fullscreen
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); return w ? w.requestFullscreen().then(() => 'ok').catch(e => String(e)) : 'no wrap' })()`)
await sleep(2000)

const state = await evalJS(`(() => {
  const v = document.querySelector('div[class*="group relative"] video')
  if (!v) return { err: 'no video' }
  const r = v.getBoundingClientRect()
  return {
    fs: !!document.fullscreenElement,
    el: { l: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    vw: v.videoWidth, vh: v.videoHeight,
    objFit: getComputedStyle(v).objectFit,
    transform: getComputedStyle(v).transform,
    zoomVar: getComputedStyle(document.querySelector('div[class*="group relative"]')).getPropertyValue('--fs-zoom'),
  }
})()`)
console.log('LIVE STATE:', JSON.stringify(state))
if (!state || state.err) process.exit(1)

// Canvas sample in INTRINSIC pixels — where is picture vs black in the source?
const px = await evalJS(`(() => {
  const v = document.querySelector('div[class*="group relative"] video')
  const c = document.createElement('canvas')
  c.width = v.videoWidth; c.height = v.videoHeight
  const ctx = c.getContext('2d')
  try { ctx.drawImage(v, 0, 0) } catch (e) { return { err: String(e).slice(0, 80) } }
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  const W = c.width, H = c.height
  const colBlack = []
  for (let x = 0; x < W; x++) {
    let black = 0, n = 0
    for (let y = 0; y < H; y += 8) { const i = (y * W + x) * 4; n++; if (d[i] < 10 && d[i+1] < 10 && d[i+2] < 10) black++ }
    colBlack.push(black / n >= 0.92)
  }
  let first = -1, last = -1
  for (let x = 0; x < W; x++) if (!colBlack[x]) { if (first < 0) first = x; last = x }
  return { W, H, firstPicX: first, lastPicX: last, leftBlack: first < 0 ? -1 : first, rightBlack: last < 0 ? -1 : W - 1 - last }
})()`)
console.log('INTRINSIC PIXELS:', JSON.stringify(px))

// Verdict
if (px && !px.err) {
  if (px.leftBlack > 0 || px.rightBlack > 0) {
    console.log('\\n→ SOURCE has baked side bars (intrinsic pixels are black at edges).')
    console.log('  With objFit=' + state.objFit + ' + fullscreen cover the element is full-bleed;')
    console.log('  any visible side black = baked bars, symmetric: L=' + px.leftBlack + ' R=' + px.rightBlack)
  } else {
    console.log('\\n→ SOURCE is clean full-width picture. Any right-edge black on screen = layout bug.')
  }
}
process.exit(0)
