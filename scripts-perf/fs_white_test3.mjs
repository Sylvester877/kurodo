// White test v3 — get fullscreen STICKING first (navigate + gesture key),
// verify fullscreenElement===wrap, overlay held, OS shot analyzed.
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
await send('Page.enable')
await send('Runtime.enable')
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) { console.log('[exc]', (r.result.exceptionDetails?.exception?.description || '').slice(0, 120)); return null }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// fresh watch page (video needed for the player)
await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/11061?ep=1' })
await sleep(20000)

// press F (the app's fullscreen shortcut) — this is a REAL user gesture via CDP
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70 })
await sleep(3000)
const fsState = await evalJS(`(() => {
  const w = document.querySelector('div[tabindex="-1"].group.relative') || document.querySelector('.group.relative')
  return { fs: !!document.fullscreenElement, isWrap: document.fullscreenElement === w }
})()`)
console.log('fs state:', JSON.stringify(fsState))

// overlay
await evalJS(`(() => {
  let o = document.getElementById('white-test-overlay')
  if (o) o.remove()
  o = document.createElement('div')
  o.id = 'white-test-overlay'
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#ffffff'
  document.body.appendChild(o)
  setTimeout(() => o.remove(), 12000)
  return 1
})()`)
const vis = await evalJS(`(() => { const o = document.getElementById('white-test-overlay'); const r = o?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null })()`)
console.log('overlay covers:', JSON.stringify(vis), '(viewport', await evalJS('innerWidth + "x" + innerHeight'), ')')

execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/fs_os_native_shot.ps1', { encoding: 'utf8' })

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
  const colMean = (x) => { let s = 0, n = 0; for (let y = 100; y < H - 100; y += 10) { const i = (y * W + x) * 4; s += (d[i] + d[i+1] + d[i+2]) / 3; n++ } return Math.round(s / n) }
  return { W, H, cols: [Math.floor(W*0.5), Math.floor(W*0.8), Math.floor(W*0.9), W-100, W-30, W-2].map((x) => ({ x, m: colMean(x) })) }
})()`)
await b.close()
console.log('column means:', JSON.stringify(res.cols))
const dark = res.cols.filter((c) => c.m < 100).map((c) => c.x)
console.log(dark.length === 0 ? '✅ WHOLE PANEL WHITE — full-bleed confirmed' : '❌ dark columns at x = ' + dark.join(', '))
process.exit(0)
