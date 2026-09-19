// Multi-moment band test: 3 fullscreen shots 2.5s apart. If the right
// black band is CONSTANT width → artifact/layout; if it changes → scene.
import WebSocket from 'ws'
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
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
await send('Page.enable')
await send('Runtime.enable')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// make sure we're fullscreen on a playing video
const st = await (async () => {
  const r = await send('Runtime.evaluate', { expression: `(() => {
    if (!document.fullscreenElement) {
      const w = document.querySelector('div[class*="group relative"]')
      if (w) w.requestFullscreen()
      return 'entering'
    }
    return 'already'
  })()`, returnByValue: true })
  return r.result?.result?.value
})()
console.log('fs:', st)
await sleep(2500)

const bandOf = async (b64) => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
  const p = await b.newPage()
  await p.setContent(`<img id=i src="data:image/png;base64,${b64}">`)
  await p.waitForSelector('#i')
  const res = await p.evaluate(`(async () => {
    const img = document.getElementById('i')
    await img.decode()
    const W = img.naturalWidth, H = img.naturalHeight
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, W, H).data
    const colMax = (x) => { let mx = 0; for (let y = 0; y < H; y += 4) { const i = (y * W + x) * 4; mx = Math.max(mx, d[i], d[i+1], d[i+2]) } return mx }
    let fb = -1
    for (let x = W - 1; x >= 0; x--) { if (colMax(x) >= 8) { fb = x + 1; break } }
    return { W, H, rightBlackPx: fb < 0 ? W : W - fb }
  })()`)
  await b.close()
  return res
}

const results = []
for (let i = 1; i <= 3; i++) {
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  const buf = Buffer.from(shot.result.data, 'base64')
  fs.writeFileSync(`screenshots/fs-band-t${i}.png`, buf)
  const r = await bandOf(buf.toString('base64'))
  results.push(r)
  console.log(`t${i}: ${r.W}x${r.H} rightBlack=${r.rightBlackPx}px`)
  await sleep(2500)
}
const widths = results.map((r) => r.rightBlackPx)
const constant = widths.every((w) => w === widths[0])
console.log('\nband widths:', widths.join(', '))
console.log(constant
  ? '→ CONSTANT band — an artifact (layout or decode), keep digging'
  : '→ band CHANGES with scene — mostly scene content in a dark-scene moment')
