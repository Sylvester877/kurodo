// One verified shot with timestamp proof.
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.on('open', r))
let rid = 0
const call = (method, params = {}) => new Promise((res, rej) => {
  const id = ++rid
  const to = setTimeout(() => rej(new Error('timeout')), 15000)
  const onMsg = (raw) => {
    const m = JSON.parse(raw)
    if (m.id === id) { ws.off('message', onMsg); clearTimeout(to); m.result ? res(m.result) : rej(new Error('err')) }
  }
  ws.on('message', onMsg)
  ws.send(JSON.stringify({ id, method, params }))
})
const evalJs = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value

const g = JSON.parse(await evalJs(`(() => {
  const v = document.querySelector('video')
  const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
  const r = wrap.getBoundingClientRect()
  return JSON.stringify({ t: +v.currentTime.toFixed(1), box: wrap.style.aspectRatio, crop: v.style.width || 'none', paused: v.paused, rect: { x: Math.max(0,r.x), y: Math.max(0,r.y), width: r.width, height: r.height } })
})()`))
const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...g.rect, scale: 1 } })
if (shot.data) {
  fs.writeFileSync('screenshots/fixed-video-3.png', Buffer.from(shot.data, 'base64'))
  console.log(`shot 3: t=${g.t}s box=${g.box} crop=${g.crop} paused=${g.paused}`)
}
ws.close()
process.exit(0)
