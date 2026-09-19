// One-shot: re-enter fullscreen in the live window, capture a FRESH
// screenshot, decode its right edge — no staleness possible.
import WebSocket from 'ws'
import puppeteer from 'puppeteer'
import fs from 'node:fs'

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
await send('Page.enable')
await send('Runtime.enable')
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Ensure fullscreen
const fsState = await evalJS(`(() => {
  if (document.fullscreenElement) return 'already'
  const w = document.querySelector('div[class*="group relative"]')
  return w ? w.requestFullscreen().then(() => 'entered').catch(e => 'ERR ' + e) : 'no wrap'
})()`)
console.log('fullscreen:', fsState)
await sleep(2500)

const live = await evalJS(`(() => {
  const v = document.querySelector('div[class*="group relative"] video')
  const r = v.getBoundingClientRect()
  return { fs: !!document.fullscreenElement, elL: Math.round(r.left), elW: Math.round(r.width), iw: window.innerWidth, dpr: window.devicePixelRatio }
})()`)
console.log('live:', JSON.stringify(live))

// Fresh capture
const shot = await send('Page.captureScreenshot', { format: 'png' })
const buf = Buffer.from(shot.result.data, 'base64')
fs.writeFileSync('screenshots/fs-gap-fullscreen.png', buf)
console.log('fresh shot saved,', buf.length, 'bytes')

// Decode immediately
const b64 = buf.toString('base64')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
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
  const colMax = (x) => { let mx = 0; for (let y = 0; y < H; y += 3) { const i = (y * W + x) * 4; mx = Math.max(mx, d[i], d[i+1], d[i+2]) } return mx }
  let fb = -1
  for (let x = W - 1; x >= 0; x--) { if (colMax(x) >= 8) { fb = x + 1; break } }
  return { W, H, rightBlackPx: fb < 0 ? W : W - fb }
})()`)
await b.close()
console.log('frame:', res.W, 'x', res.H, '| right black band:', res.rightBlackPx, 'px')
console.log(res.rightBlackPx <= 2 ? '✅ PASS' : '❌ FAIL')
process.exit(0)
