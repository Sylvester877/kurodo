// Final P2 screenshot set across the main pages.
import WebSocket from 'ws'
import fs from 'node:fs'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
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

// Home top
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(8000); await evalJs('window.scrollTo(0,0)'); await sleep(1800)
await shot('p2-final-home-top.png')
await evalJs('window.scrollTo(0, 900)'); await sleep(2800)
await shot('p2-final-home-feed.png')

// Browse
await send('Page.navigate', { url: 'http://127.0.0.1:5173/browse' })
await sleep(7000)
await shot('p2-final-browse.png')

// Details
await send('Page.navigate', { url: 'http://127.0.0.1:5173/anime/5114' })
await sleep(8000)
await evalJs('window.scrollTo(0, 0)'); await sleep(800)
await shot('p2-final-details.png')

// Watch (UI shell + ep list)
await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/5114?ep=1' })
await sleep(9000)
await evalJs('window.scrollTo(0, 0)'); await sleep(600)
await shot('p2-final-watch.png')

// Settings
await send('Page.navigate', { url: 'http://127.0.0.1:5173/settings' })
await sleep(6000)
await shot('p2-final-settings.png')
ws.close()
console.log('all shots done')
