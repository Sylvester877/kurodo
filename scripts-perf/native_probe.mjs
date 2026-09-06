// Live probe of the new Electron native features over CDP.
// 1. window.electronAPI.setPlaybackActive exists
// 2. Invoke it true+false (main logs 'Display sleep blocked/unblocked')
// 3. Resize window → expect window-state.json to be written
import WebSocket from 'ws'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('NO_PAGE'); process.exit(1) }
console.log('PAGE_URL:', page.url.slice(0, 80))

const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id
  pending.set(mid, { resolve, reject })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString())
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result)
  }
})
await new Promise((r) => ws.on('open', r))

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.value
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. API surface
const hasApi = await ev(`!!window.electronAPI && typeof window.electronAPI.setPlaybackActive === 'function'`)
console.log('setPlaybackActive present:', hasApi)

// 2. Toggle the power blocker through the real IPC chain
await ev(`window.electronAPI.setPlaybackActive(true)`)
await sleep(600)
await ev(`window.electronAPI.setPlaybackActive(false)`)
await sleep(600)
console.log('power blocker toggled — check main log')

// 3. Resize → persist
const { windowId } = await send('Browser.getWindowForTarget')
await send('Browser.setWindowBounds', { windowId, bounds: { width: 1100, height: 720 } })
await sleep(1500)
const state = await ev(`(async () => {
  // cannot read fs from renderer; just report current inner size
  return { w: window.innerWidth, h: window.innerHeight }
})()`)
console.log('resized inner:', JSON.stringify(state))

ws.close()
