// GROUND TRUTH from the live window:
//  1. Which bundle is loaded vs what's on disk (stale-build check).
//  2. Native-res edge analysis with smoothing DISABLED (what the detector
//     should have seen): per-column bright-pixel fraction for first/last 12
//     columns, so real bars vs textured scene edges is unambiguous.
//  3. Current crop/zoom state + geometry.
import WebSocket from 'ws'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const diskHash = execSync('ls dist/assets | grep "^index-.*\\.js" | head -1').toString().trim()
console.log('disk bundle:', diskHash)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.on('open', r))
let rid = 0
const evalOn = (expr) => new Promise((res, rej) => {
  const id = ++rid
  const to = setTimeout(() => rej(new Error('eval timeout')), 6000)
  const onMsg = (raw) => {
    const m = JSON.parse(raw)
    if (m.id === id) { ws.off('message', onMsg); clearTimeout(to); m.result?.result ? res(m.result.result.value) : rej(new Error('eval err')) }
  }
  ws.on('message', onMsg)
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }))
})

console.log('page url:', page.url)
const truth = await evalOn(`(async () => {
  const bundles = performance.getEntriesByType('resource').filter(r => r.name.includes('/assets/index-')).map(r => r.name.split('/').pop())
  const v = document.querySelector('video')
  if (!v) return { hasVideo: false, bundles }
  const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
  // Native-res read, smoothing OFF — per-column bright pixel fraction.
  const W = v.videoWidth, H = v.videoHeight
  const SW = Math.max(64, Math.floor(W / 4)), SH = Math.max(36, Math.floor(H / 4)) // nearest-neighbor 4x
  const c = document.createElement('canvas'); c.width = SW; c.height = SH
  const x = c.getContext('2d', { willReadFrequently: true })
  x.imageSmoothingEnabled = false
  x.drawImage(v, 0, 0, SW, SH)
  const d = x.getImageData(0, 0, SW, SH).data
  const lum = (i) => 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]
  const brightFrac = (col) => { let n = 0; for (let y = 0; y < SH; y++) if (lum((y*SW+col)*4) > 26) n++; return n/SH }
  const left12 = [], right12 = []
  for (let col = 0; col < 12; col++) { left12.push(+brightFrac(col).toFixed(3)); right12.push(+brightFrac(SW-1-col).toFixed(3)) }
  // center reference
  let cn = 0; for (let y = 0; y < SH; y++) if (lum((y*Math.floor(SW/2))*4 + 0*4) > 26) cn++
  const vr = v.getBoundingClientRect(), wr = wrap.getBoundingClientRect()
  return {
    hasVideo: true, bundles,
    stream: v.videoWidth + 'x' + v.videoHeight,
    box: wrap.style.aspectRatio,
    videoStyles: { w: v.style.width, left: v.style.left, transform: getComputedStyle(v).transform },
    objectFit: getComputedStyle(v).objectFit,
    t: +v.currentTime.toFixed(0), paused: v.paused,
    edgesBrightFrac: { left12, right12 },
    note: 'frac ~0 = flat black bar; frac high = picture/texture',
  }
})()`)
console.log(JSON.stringify(truth, null, 2))
ws.close()
process.exit(0)
