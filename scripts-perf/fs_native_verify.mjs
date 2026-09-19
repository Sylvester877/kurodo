// FINAL: fullscreen confirmed via CDP + native-res OS shot in the same
// second + panel-edge RLE. This is the definitive right-gap measurement.
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
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ensure fullscreen & playing
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); if (w && document.fullscreenElement !== w) w.requestFullscreen(); return 1 })()`)
await sleep(2500)
const conf = await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); const v = w?.querySelector('video'); return { fs: document.fullscreenElement === w, playing: v ? !v.paused && v.currentTime > 0 : false, rect: v ? (r => ({ l: r.left, r: r.right }))(v.getBoundingClientRect()) : null } })()`)
console.log('CDP truth:', JSON.stringify(conf))
if (!conf?.fs) { console.log('NOT fullscreen — abort'); process.exit(1) }

// native OS shot immediately
const out = execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/fs_os_native_shot.ps1', { encoding: 'utf8' })
console.log(out.trim())

// analyze
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
  const rightRun = (y) => { let n = 0; for (let x = W - 1; x >= 0; x--) { const i = (y * W + x) * 4; if (Math.max(d[i], d[i+1], d[i+2]) >= 24) return n; n++ } return n }
  const leftRun = (y) => { let n = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.max(d[i], d[i+1], d[i+2]) >= 24) return n; n++ } return n }
  const rows = [200, 400, 600, 800, 1000]
  return { W, H, right: rows.map(rightRun), left: rows.map(leftRun) }
})()`)
await b.close()
console.log('native panel:', res.W, 'x', res.H)
console.log('right black (physical px, 5 rows):', res.right.join(', '))
console.log('left  black (physical px, 5 rows):', res.left.join(', '))
const maxR = Math.max(...res.right)
const maxL = Math.max(...res.left)
console.log(maxR <= 14 ? '✅ PANEL TRUTH: no right gap (≤14px physical = ≤11 css = rounding)' : '❌ PANEL TRUTH: right gap up to ' + maxR + 'px physical')
console.log(maxL <= 14 ? '✅ no left gap' : '⚠️ left black up to ' + maxL + 'px physical (' + Math.round(maxL / 1.25) + ' css) — check')
process.exit(0)
