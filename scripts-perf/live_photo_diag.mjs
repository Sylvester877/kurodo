// Inspect the LIVE player state: video-fit setting, crop geometry actually
// applied, box aspect, and where the video rect sits relative to the box.
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value ?? null
}
await new Promise((r) => ws.on('open', r))

console.log('url:', page.url)
const state = await evalJs(`(async () => {
  const v = document.querySelector('video')
  if (!v) return { hasVideo: false }
  const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
  const wr = wrap.getBoundingClientRect()
  const vr = v.getBoundingClientRect()
  const cs = getComputedStyle(v)
  // Persisted video-fit setting
  let fitSetting = null
  try {
    const s = JSON.parse(localStorage.getItem('kurodo-settings') || localStorage.getItem('settings') || '{}')
    fitSetting = s.videoFit ?? s.state?.videoFit ?? null
  } catch {}
  // Sample the ACTUAL current frame edges (same as the detector sees)
  let edges = null
  try {
    const W = 32, H = 18
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(v, 0, 0, W, H)
    const d = x.getImageData(0, 0, W, H).data
    const lum = (xx, yy) => { const i = (yy * W + xx) * 4; return 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2] }
    const colM = []
    for (let xx = 0; xx < W; xx++) { let s = 0; for (let yy = 0; yy < H; yy++) s += lum(xx, yy); colM.push(+(s/H).toFixed(1)) }
    const std = (xx) => { const m = colM[xx]; let v2 = 0; for (let yy = 0; yy < H; yy++) { const l = lum(xx, yy); v2 += (l-m)*(l-m) } return +Math.sqrt(v2/H).toFixed(1) }
    edges = { first8: colM.slice(0, 8), last8: colM.slice(-8), stdFirst4: [0,1,2,3].map(std), stdLast4: [28,29,30,31].map(std) }
  } catch (e) { edges = 'tainted: ' + e.message }
  return {
    hasVideo: true,
    stream: v.videoWidth + 'x' + v.videoHeight,
    streamAspect: +(v.videoWidth / v.videoHeight).toFixed(4),
    boxAspectCss: wrap.style.aspectRatio,
    boxRect: Math.round(wr.width) + 'x' + Math.round(wr.height),
    boxAspectActual: +(wr.width / wr.height).toFixed(4),
    videoStyle: { w: v.style.width, h: v.style.height, left: v.style.left, top: v.style.top },
    objectFit: cs.objectFit,
    videoRect: Math.round(vr.width) + 'x' + Math.round(vr.height),
    videoOffsetVsBox: { dx: Math.round(vr.left - wr.left), dy: Math.round(vr.top - wr.top) },
    pictureSpilling: vr.right > wr.right + 2 || vr.bottom > wr.bottom + 2 || vr.left < wr.left - 2 || vr.top < wr.top - 2,
    fitSetting,
    frameEdges: edges,
    t: v.currentTime.toFixed(0), paused: v.paused,
  }
})()`)
console.log(JSON.stringify(state, null, 2))

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) { fs.writeFileSync('screenshots/live-state-photo-check.png', Buffer.from(shot.result.data, 'base64')); console.log('saved screenshots/live-state-photo-check.png') }
ws.close()
process.exit(0)
