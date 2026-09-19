// Post-fix panel check: confirm the window is fullscreen NOW, take a fresh
// native shot, and measure all four edges.
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

// re-enter fullscreen on the current page
await evalJS(`(() => { const w = document.querySelector('div[tabindex="-1"].group.relative') || document.querySelector('.group.relative'); if (w && document.fullscreenElement !== w) w.requestFullscreen(); return 1 })()`)
await sleep(3000)
console.log('window rect now:', execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/winrect.ps1', { encoding: 'utf8' }).trim())
console.log('cdp fs:', await evalJS(`!!document.fullscreenElement`))

// native OS shot
execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/fs_os_native_shot.ps1', { encoding: 'utf8' })

// analyze all 4 edges
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
console.log('right black:', res.right.join(', '), '| left black:', res.left.join(', '))
const maxR = Math.max(...res.right)
const maxL = Math.max(...res.left)
console.log(maxR <= 14 ? 'RIGHT: full-bleed ✅' : 'RIGHT: ' + maxR + 'px physical black')
console.log(maxL <= 14 ? 'LEFT: full-bleed ✅' : 'LEFT: ' + maxL + 'px physical black')
process.exit(0)
