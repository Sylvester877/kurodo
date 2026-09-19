// Who owns the black: DWM says window = 0..1920x1200 exactly. But the OS
// shot shows content only to 1760. Two Chromium shots exist: the app's own
// Page.captureScreenshot shows content 0..1910 (10px band). The OS shows
// 0..1760. The app surface HAS the pixels — the question is whether DWM
// scales the window surface. Compare OS shot against Chromium shot scaled:
// if OS-shot content 0..1760 == Chromium-shot content 0..1760*1920/1920...
// simpler: diff OS shot's right band (1760..1920) — if pure black while the
// Chromium shot has picture there, then DWM/vsync is showing stale/scaled
// surface ONLY in the capture (CopyFromScreen reads the desktop composition
// texture). The REAL panel could still show it (capture ≠ panel on HDR/
// scaled setups).
// Definitive user-space test: display a BRIGHT WHITE full-viewport overlay
// in the app at fullscreen; if the OS shot's right band stays black while
// the rest is white, the compositor truly doesn't paint there (bug on
// panel); if the band turns white, capture was stale.
import WebSocket from 'ws'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import puppeteer from 'puppeteer'

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
await send('Runtime.enable')
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ensure fullscreen
await evalJS(`(() => { const w = document.querySelector('div[tabindex="-1"].group.relative'); if (w && document.fullscreenElement !== w) w.requestFullscreen(); return 1 })()`)
await sleep(2500)

// white overlay across the whole viewport
await evalJS(`(() => {
  let o = document.getElementById('white-test-overlay')
  if (!o) {
    o = document.createElement('div')
    o.id = 'white-test-overlay'
    document.body.appendChild(o)
  }
  o.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#fff;pointer-events:none'
  return 'overlay on'
})()`)
await sleep(1200)
const PS = fs.readFileSync('scripts-perp/fs_os_native_shot.ps1'.replace('perp','perf'), 'utf8')
fs.writeFileSync('scripts-perf/os-shot-active.ps1', PS.replace('fs-os-native.png', 'fs-white-test.png'))
execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/os-shot-active.ps1', { encoding: 'utf8' })

// remove overlay
await evalJS(`(() => { document.getElementById('white-test-overlay')?.remove(); return 'off' })()`)

// analyze: is the right band white now?
const b64 = fs.readFileSync('screenshots/fs-white-test.png').toString('base64')
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
  return {
    W, H,
    center: px(Math.floor(W/2), Math.floor(H/2)),
    rightBand: px(W - 80, Math.floor(H/2)),
    rightEdge: px(W - 2, Math.floor(H/2)),
    leftEdge: px(2, Math.floor(H/2)),
  }
})()`)
await b.close()
console.log('white-overlay panel test:', JSON.stringify(res))
const bandWhite = res.rightBand[0] > 200
console.log(bandWhite ? '✅ right band turns WHITE with overlay → compositor paints full window; earlier black = stale capture of video layer' : '❌ right band stays black → the window surface truly is not covering the panel')
process.exit(0)
