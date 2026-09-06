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
await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/16498?ep=1' })
await sleep(11000)
const st = await evalJs(`(() => {
  const all = [...document.querySelectorAll('div')]
  const aura = all.filter(d => (d.className||'').includes('-z-10') && /radial-gradient/.test(d.style.background||'')).map(d => d.style.background.slice(0, 80))
  const bottomGlow = all.filter(d => /rgb\\([^)]*\\/ 0\\.22\\)/.test(d.style.background||'')).map(d => d.style.background.slice(0, 80))
  return { aura, bottomGlow, reduceQ: (() => { try { const s = JSON.parse(localStorage.getItem('kurodo-settings')||'{}'); return s?.state?.reduceQuality ?? null } catch { return '?' } })() }
})()`)
console.log('GLOWS:', JSON.stringify(st, null, 1))
await shot('watch-glow-final.png')
ws.close()
