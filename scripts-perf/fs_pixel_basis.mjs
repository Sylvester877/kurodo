// A/B/C: fullscreen vs windowed native OS shots — does the right 159px
// band exist only in fullscreen, or is the capture path unreliable?
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
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const PS = fs.readFileSync('scripts-perf/fs_os_native_shot.ps1', 'utf8')
const shot = (name) => {
  fs.writeFileSync('scripts-perf/os-shot-active.ps1', PS.replace('fs-os-native.png', `${name}.png`))
  execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/os-shot-active.ps1', { encoding: 'utf8' })
  console.log('shot:', name)
}

// A: fullscreen
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); if (w && document.fullscreenElement !== w) w.requestFullscreen(); return 1 })()`)
await sleep(3000)
console.log('fs before A:', await evalJS(`!!document.fullscreenElement`))
shot('fs-basis-a')

// B: windowed
await evalJS(`document.exitFullscreen?.()`)
await sleep(2200)
console.log('fs before B:', await evalJS(`!!document.fullscreenElement`))
shot('fs-basis-b')

// C: fullscreen again
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); if (w) w.requestFullscreen(); return 1 })()`)
await sleep(3000)
console.log('fs before C:', await evalJS(`!!document.fullscreenElement`))
shot('fs-basis-c')

const analyze = async (file) => {
  const b64 = fs.readFileSync(`screenshots/${file}.png`).toString('base64')
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
    return { W, H, right: [200, 600, 1000].map(rightRun) }
  })()`)
  await b.close()
  return res
}
for (const f of ['fs-basis-a', 'fs-basis-b', 'fs-basis-c']) {
  const r = await analyze(f)
  console.log(`${f}: ${r.W}x${r.H} right-black rows: [${r.right.join(', ')}]`)
}
process.exit(0)
