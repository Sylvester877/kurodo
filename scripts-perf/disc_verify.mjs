// Verify glass play discs across rails; screenshots.
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
await sleep(9000)
await evalJs(`window.scrollTo(0, 1150)`) // Recent Episodes area
await sleep(2800)
const discs = await evalJs(`(() => {
  const glass = [...document.querySelectorAll('div')].filter(d => (d.className || '').includes('backdrop-blur-md') && (d.className || '').includes('rounded-full') && (d.className || '').includes('border-white/25')).length
  const solid = [...document.querySelectorAll('div')].filter(d => /bg-primary\/9[05]/.test(d.className || '')).length
  return { glassDiscs: glass, solidDiscs: solid }
})()`)
console.log('DISCS:', JSON.stringify(discs))
await shot('polish-recent-hover-area.png')
ws.close()
console.log('done')
