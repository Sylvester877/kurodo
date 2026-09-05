// Root-cause the "black space on the right" of the video in the INSTALLED app.
// Navigates to a watch page, waits for a real <video>, then measures:
//   video rect, wrapper rect, intrinsic aspect, object-fit, sidebar presence,
//   and per-column luminance across the player region (detects black bands).
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

// Poll until a <video> with metadata shows up (max 40s)
let have = false
for (let i = 0; i < 20; i++) {
  await sleep(2000)
  have = await evalJs(`(() => { const v=document.querySelector('video'); return !!(v && v.videoWidth>0) })()`)
  if (have) break
  console.log('waiting for video...', i)
}
if (!have) {
  console.log('no video with metadata after 40s; page state:')
  console.log(await evalJs(`document.querySelector('body')?.innerText.slice(0,400)`))
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) fs.writeFileSync('screenshots/video-gap-novideo.png', Buffer.from(shot.result.data, 'base64'))
  process.exit(1)
}

const geo = await evalJs(`(() => {
  const v = document.querySelector('video')
  const wrap = v.closest('[class*="aspect-video"]') || v.parentElement
  const vb = v.getBoundingClientRect()
  const wb = wrap.getBoundingClientRect()
  const cs = getComputedStyle(v)
  // Find the sidebar (the 380px column) — first element right of the wrapper
  let sidebar = null
  let el = wrap.parentElement
  while (el && !sidebar) {
    for (const c of el.children) {
      const r = c.getBoundingClientRect()
      if (r.left >= wb.right - 2 && r.width > 100) { sidebar = { tag: c.tagName, cls: (c.className||'').toString().slice(0,80), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; break }
    }
    el = el.parentElement
  }
  return JSON.stringify({
    win: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    videoMeta: { vw: v.videoWidth, vh: v.videoHeight, intrinsicAspect: (v.videoWidth / v.videoHeight).toFixed(4) },
    videoBox: { x: Math.round(vb.x), w: Math.round(vb.width), h: Math.round(vb.height), right: Math.round(vb.right) },
    wrapBox: { x: Math.round(wb.x), w: Math.round(wb.width), h: Math.round(wb.height), right: Math.round(wb.right) },
    wrapAspect: (wb.width / wb.height).toFixed(4),
    videoFit: cs.objectFit,
    sidebar,
    rightGapPx: Math.round(innerWidth - vb.right),
  })
})()`)
console.log(geo)

// Screenshot + column luminance across the video's vertical center
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync('screenshots/video-gap-playing.png', Buffer.from(shot.result.data, 'base64'))

const lum = await evalJs(`(async () => {
  const img = await new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = rej
    i.src = document.querySelector('video').currentSrc || ''
  }).catch(() => null)
  // Sample the rendered page instead: draw a horizontal strip at video center via html2canvas-free approach — use the video element itself for intrinsic letterbox check
  const v = document.querySelector('video')
  const c = document.createElement('canvas')
  c.width = 64; c.height = 36
  const ctx = c.getContext('2d')
  try { ctx.drawImage(v, 0, 0, 64, 36) } catch (e) { return 'drawImage blocked: ' + e.message }
  const d = ctx.getImageData(0, 18, 64, 1).data
  let out = []
  for (let x = 0; x < 64; x += 4) {
    const i = x * 4
    out.push(Math.round((d[i] + d[i+1] + d[i+2]) / 3))
  }
  return 'video-intrinsic row luminance (left..right): ' + out.join(',')
})()`)
console.log(lum)

ws.close()
process.exit(0)
