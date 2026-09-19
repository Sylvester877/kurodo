// White test v2 — fullscreen + overlay held while the OS shot happens.
// Also check overlay VISIBILITY state right before the shot.
import WebSocket from 'ws'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import puppeteer from 'puppeteer'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page'); process.exit(1) }
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
await send('Runtime.enable')
await send('Page.enable')
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) { console.log('[exc]', (r.result.exceptionDetails?.exception?.description || '').slice(0, 120)); return null }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// fullscreen
await evalJS(`(() => { const w = document.querySelector('div[tabindex="-1"].group.relative'); if (w && document.fullscreenElement !== w) w.requestFullscreen(); return 1 })()`)
await sleep(3000)
console.log('fs:', await evalJS(`!!document.fullscreenElement`))

// overlay with a self-removing timer long enough to cover the capture
await evalJS(`(() => {
  let o = document.getElementById('white-test-overlay')
  if (o) o.remove()
  o = document.createElement('div')
  o.id = 'white-test-overlay'
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#ffffff'
  document.body.appendChild(o)
  setTimeout(() => o.remove(), 15000)
  return 'overlay armed 15s'
})()`)
await sleep(800)
const vis = await evalJS(`(() => { const o = document.getElementById('white-test-overlay'); if (!o) return { gone: true }; const r = o.getBoundingClientRect(); return { w: r.width, h: r.height, bg: getComputedStyle(o).backgroundColor, visible: !!o.offsetParent || getComputedStyle(o).position === 'fixed' } })()`)
console.log('overlay:', JSON.stringify(vis))

execSync('powershell -ExecutionPolicy Bypass -File scripts-perp/fs_os_native_shot.ps1'.replace('perp', 'perf'), { encoding: 'utf8' })
console.log('shot taken; overlay still:', await evalJS(`!!document.getElementById('white-test-overlay')`))

const b64 = fs.readFileSync('screenshots/fs-os-native.png').toString('base64')
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
  const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i+1], d[i+2]] }
  // column means for the right 20%
  const cols = []
  for (const x of [Math.floor(W*0.8), Math.floor(W*0.88), Math.floor(W*0.92), W - 80, W - 30, W - 2]) {
    let s = 0, n = 0
    for (let y = 100; y < H - 100; y += 10) { const i = (y * W + x) * 4; s += (d[i] + d[i+1] + d[i+2]) / 3; n++ }
    cols.push({ x, mean: Math.round(s / n) })
  }
  return { W, H, cols, center: px(Math.floor(W/2), Math.floor(H/2)) }
})()`)
await b.close()
console.log('column means (0-255):', JSON.stringify(res.cols))
const allWhite = res.cols.every((c) => c.mean > 180)
console.log(allWhite ? '✅ WHOLE panel white — window surface covers everything; earlier band was stale video capture' : '❌ right columns dark — surface truly not covering panel')
process.exit(0)
