// Verify the smart-aspect player in the live app: wrapper uses CSS
// aspect-ratio (new code), video fills it exactly, and capture proof.
import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1200, deviceScaleFactor: 0, mobile: false })
await send('Page.navigate', { url: 'http://localhost:5173/watch/5114?ep=1' })

let have = false
for (let i = 0; i < 20; i++) {
  await sleep(2000)
  have = await evalJs(`(() => { const v=document.querySelector('video'); return !!(v && v.videoWidth>0) })()`)
  if (have) break
}
if (!have) { console.log('no video after 40s'); process.exit(1) }
await sleep(2000)

const geo = await evalJs(`(() => {
  const v = document.querySelector('video')
  const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
  const vb = v.getBoundingClientRect()
  const wb = wrap.getBoundingClientRect()
  const cs = getComputedStyle(wrap)
  return JSON.stringify({
    wrapAspectCss: cs.aspectRatio,
    videoBox: { w: Math.round(vb.width), h: Math.round(vb.height) },
    wrapBox: { w: Math.round(wb.width), h: Math.round(wb.height) },
    boxMatchesStream: Math.abs((vb.width/vb.height) - (v.videoWidth/v.videoHeight)) < 0.01,
    videoFillsBox: Math.abs(vb.width - wb.width) < 2 && Math.abs(vb.height - wb.height) < 2,
    objectFit: getComputedStyle(v).objectFit,
    transform: getComputedStyle(v).transform,
  })
})()`)
console.log(geo)

const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync('screenshots/player-smart-aspect.png', Buffer.from(shot.result.data, 'base64'))
console.log('screenshot saved')
ws.close()
process.exit(0)
