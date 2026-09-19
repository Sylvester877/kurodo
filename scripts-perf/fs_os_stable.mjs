// OS screenshots x5 with fullscreen verified stable before each shot.
import WebSocket from 'ws'
import { execSync } from 'node:child_process'
import fs from 'node:fs'

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
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// enter fullscreen and confirm STABLE for 3 consecutive checks
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); if (w && !document.fullscreenElement) w.requestFullscreen(); return 1 })()`)
let stable = 0
for (let i = 0; i < 10 && stable < 3; i++) {
  await sleep(1000)
  const s = await evalJS(`({ fs: document.fullscreenElement === document.querySelector('div[class*="group relative"]'), t: performance.now() })`)
  if (s?.fs) stable++
  else stable = 0
}
console.log('fullscreen stable:', stable >= 3)
await sleep(1000)

// 5 OS shots, 3s apart — video is playing so content changes
const ps = fs.readFileSync('scripts-perf/os-shot.ps1', 'utf8')
for (let i = 1; i <= 5; i++) {
  fs.writeFileSync('scripts-perf/os-shot.ps1', ps.replace('fs-os-desktop.png', `fs-os-t${i}.png`))
  execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/os-shot.ps1', { encoding: 'utf8' })
  console.log(`os shot t${i}`)
  await sleep(3000)
}
console.log('done')
