// Diagnose the over-crop: read autoZoom transform, wrapper geometry, stream size.
import WebSocket from 'ws'

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
  return r.result?.result?.value ?? r.result?.result?.description ?? null
}
await new Promise((r) => ws.on('open', r))

console.log('url:', page.url)
const info = await evalJs(`(() => {
  const v = document.querySelector('video')
  if (!v) return { hasVideo: false }
  const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
  const wr = wrap?.getBoundingClientRect()
  const vr = v.getBoundingClientRect()
  return {
    hasVideo: true,
    stream: v.videoWidth + 'x' + v.videoHeight,
    streamAspect: (v.videoWidth / v.videoHeight).toFixed(4),
    wrapRect: wr ? Math.round(wr.width) + 'x' + Math.round(wr.height) : null,
    wrapAspectCss: wrap?.style?.aspectRatio || null,
    wrapTransform: wrap?.style?.transform || 'none',
    videoTransform: getComputedStyle(v).transform,
    videoFit: getComputedStyle(v).objectFit,
    videoRect: Math.round(vr.width) + 'x' + Math.round(vr.height),
    currentTime: v.currentTime.toFixed(1),
    paused: v.paused,
  }
})()`)
console.log(JSON.stringify(info, null, 2))

// Screenshot just the player area, full res.
const rect = await evalJs(`(() => {
  const v = document.querySelector('video'); if (!v) return null
  const r = v.getBoundingClientRect()
  return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height }
})()`)
if (rect) {
  await send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(rect.x + rect.width), height: Math.ceil(rect.y + rect.height), deviceScaleFactor: 1, mobile: false })
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } })
  if (shot.result?.data) {
    const fs = await import('node:fs')
    fs.writeFileSync('screenshots/zoom-crop-now.png', Buffer.from(shot.result.data, 'base64'))
    console.log('saved screenshots/zoom-crop-now.png')
  }
  await send('Emulation.clearDeviceMetricsOverride')
}
ws.close()
process.exit(0)
