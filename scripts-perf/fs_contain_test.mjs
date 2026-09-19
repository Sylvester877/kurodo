// Contain-mode fullscreen test on 16:10: set videoFit=contain (default),
// enter fullscreen, OS-screenshot, verify bars are top/bottom SYMMETRIC.
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

// 1. Force videoFit=contain in the settings store
const set = await evalJS(`(() => {
  // zustand persist key
  const raw = localStorage.getItem('kurodo-settings')
  if (!raw) return 'no settings'
  const j = JSON.parse(raw)
  j.state.videoFit = 'contain'
  localStorage.setItem('kurodo-settings', JSON.stringify(j))
  return 'set contain'
})()`)
console.log('fit:', set)
await sleep(600)
await evalJS(`location.reload()`)
await sleep(9000)

// 2. fullscreen
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); if (w) w.requestFullscreen(); return 1 })()`)
await sleep(3500)
const state = await evalJS(`(() => {
  const v = document.querySelector('div[class*="group relative"] video')
  return v ? { objFit: getComputedStyle(v).objectFit, wh: v.videoWidth + 'x' + v.videoHeight, fs: !!document.fullscreenElement } : null
})()`)
console.log('state:', JSON.stringify(state))

// 3. OS shot
const ps = fs.readFileSync('scripts-perf/os-shot.ps1', 'utf8').replace(/fs-os-[a-z0-9]+\.png/, 'fs-os-contain.png')
fs.writeFileSync('scripts-perf/os-shot.ps1', ps)
execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/os-shot.ps1', { encoding: 'utf8' })
console.log('os shot saved')

// 4. analyze: bars top/bottom symmetric?
const b64 = fs.readFileSync('screenshots/fs-os-contain.png').toString('base64')
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
  const rowPic = (y) => { let n = 0; for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 4; if (Math.max(d[i], d[i+1], d[i+2]) >= 24) n++ } return n / (W / 2) }
  let top = 0; while (top < H && rowPic(top) < 0.05) top++
  let bot = 0; while (bot < H && rowPic(H - 1 - bot) < 0.05) bot++
  const colPic = (x) => { let n = 0; for (let y = 0; y < H; y += 2) { const i = (y * W + x) * 4; if (Math.max(d[i], d[i+1], d[i+2]) >= 24) n++ } return n / (H / 2) }
  let left = 0; while (left < W && colPic(left) < 0.05) left++
  let right = 0; while (right < W && colPic(W - 1 - right) < 0.05) right++
  return { W, H, topBar: top, bottomBar: bot, leftBar: left, rightBar: right }
})()`)
await b.close()
console.log('bars (css px): top', res.topBar, '| bottom', res.bottomBar, '| left', res.leftBar, '| right', res.rightBar)
const sideOk = res.leftBar <= 2 && res.rightBar <= 2
const symOk = res.topBar === 0 ? res.bottomBar === 0 : Math.abs(res.topBar - res.bottomBar) <= 6
console.log(sideOk && symOk ? 'PASS - no side bars, top/bottom symmetric' : 'FAIL - sides: ' + res.leftBar + '/' + res.rightBar + ' top/bottom: ' + res.topBar + '/' + res.bottomBar)
process.exit(0)
