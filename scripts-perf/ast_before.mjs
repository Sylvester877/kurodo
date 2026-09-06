// Before-state captures for the aesthetic pass.
import WebSocket from 'ws'
import fs from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.on('open', r))
const evalJs = async (expr) => { const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return m.result?.result?.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`screenshots/${name}`, Buffer.from(s.result.data, 'base64')); console.log('shot', name) }
await send('Page.enable'); await send('Runtime.enable')

await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(8000)
// Position the camera on the empty Continue Watching strip (right under the hero)
await evalJs(`window.scrollTo(0, 620)`)
await sleep(2200)
await shot('ast-before-home-emptyrail.png')

// Grid area lower
await evalJs(`window.scrollTo(0, 1500)`)
await sleep(2600)
await shot('ast-before-home-grid.png')

// Details
await send('Page.navigate', { url: 'http://127.0.0.1:5173/anime/5114' })
await sleep(8000)
await shot('ast-before-details.png')

// 404
await send('Page.navigate', { url: 'http://127.0.0.1:5173/does-not-exist-xyz' })
await sleep(5000)
await shot('ast-before-404.png')
ws.close()
console.log('before set done')
