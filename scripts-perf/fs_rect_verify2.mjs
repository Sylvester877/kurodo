// Verify the enter-html-full-screen window fix with a file-based script
// (inline quoting was fighting me). Fullscreen → window must cover panel.
import WebSocket from 'ws'
import { execSync } from 'node:child_process'

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
  if (r.result?.exceptionDetails) { console.log('[exc]', (r.result.exceptionDetails?.exception?.description || '').slice(0, 150)); return null }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const winRect = () => execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/winrect.ps1', { encoding: 'utf8' }).trim()

// navigate to watch page fresh
await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/11061?ep=1' })
await sleep(20000)
console.log('before FS:', winRect())

// find the wrapper with a robust selector and go fullscreen
const ok = await evalJS(`(() => {
  const w = document.querySelector('div[tabindex="-1"].group.relative') || document.querySelector('.group.relative')
  if (!w) return 'no wrapper'
  return w.requestFullscreen().then(() => 'requested').catch((e) => 'ERR ' + e.message)
})()`)
console.log('requestFullscreen:', ok)
await sleep(3500)
console.log('in FS:   ', winRect())
const st = await evalJS(`(() => {
  const w = document.querySelector('div[tabindex="-1"].group.relative') || document.querySelector('.group.relative')
  const v = w?.querySelector('video')
  return { fs: !!document.fullscreenElement, fsIsWrap: document.fullscreenElement === w, video: v ? (r => ({ l: Math.round(r.left), r: Math.round(r.right), iw: innerWidth }))(v.getBoundingClientRect()) : null }
})()`)
console.log('cdp:', JSON.stringify(st))

// restore
await evalJS(`document.exitFullscreen && document.exitFullscreen()`)
await sleep(2000)
console.log('after FS:', winRect())
process.exit(0)
