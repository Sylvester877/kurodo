// Diagnose "black space on the right of the video" in the LIVE installed app.
// Measures: window size, player wrapper box, <video> box, video metadata
// (videoWidth/Height, aspect), computed object-fit, and rounded corners.
import WebSocket from 'ws'
import http from 'node:http'

function getJson(pathname, port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname, timeout: 3000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
}

const PORT = Number(process.env.CDP_PORT || 9223)
const list = await getJson('/json/list', PORT)
const page = list.find((t) => t.type === 'page')
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

let msgId = 0
const pending = new Map()
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}

console.log('url:', await evalJs('location.href'))
console.log(await evalJs(`(() => {
  const v = document.querySelector('video')
  const wrap = v ? v.closest('div[group]') || v.parentElement : null
  if (!v) return 'NO VIDEO ELEMENT on page'
  const vb = v.getBoundingClientRect()
  const wb = wrap ? wrap.getBoundingClientRect() : null
  const cs = getComputedStyle(v)
  const wrapCs = wrap ? getComputedStyle(wrap) : null
  return JSON.stringify({
    window: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    videoMeta: { vw: v.videoWidth, vh: v.videoHeight, ready: v.readyState },
    videoBox: { x: Math.round(vb.x), y: Math.round(vb.y), w: Math.round(vb.width), h: Math.round(vb.height) },
    wrapBox: wb ? { x: Math.round(wb.x), y: Math.round(wb.y), w: Math.round(wb.width), h: Math.round(wb.height) } : null,
    videoStyle: { objectFit: cs.objectFit, w: cs.width, h: cs.height },
    wrapStyle: wrapCs ? { maxWidth: wrapCs.maxWidth, padding: wrapCs.padding, borderRadius: wrapCs.borderRadius, aspectRatio: wrapCs.aspectRatio, overflow: wrapCs.overflow } : null,
  }, null, 1)
})()`, { returnByValue: true }))

ws.close()
process.exit(0)
