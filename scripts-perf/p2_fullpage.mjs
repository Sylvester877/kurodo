// Batch-4 verification: cursor pointer on buttons, hero wordmark weight, full-page home shot.
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
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(9000)
await evalJs('window.scrollTo(0,0)')
await sleep(1500)
const checks = await evalJs(`(() => {
  const btn = document.querySelector('nav button')
  const wm = document.querySelector('.hero-wordmark')
  const wmStyle = wm ? { w: getComputedStyle(wm).fontWeight, f: getComputedStyle(wm).fontFamily.split(',')[0] } : null
  return { btnCursor: btn ? getComputedStyle(btn).cursor : null, wmStyle, heroH: Math.round(document.querySelector('section').getBoundingClientRect().height), vh: innerHeight }
})()`)
console.log('CHECKS:', JSON.stringify(checks))
// Full-page capture for the gallery
const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
fs.writeFileSync('screenshots/p2-fullpage-home.png', Buffer.from(s.result.data, 'base64'))
console.log('fullpage saved')
ws.close()
