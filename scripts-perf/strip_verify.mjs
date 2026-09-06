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
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`screenshots/${name}`, Buffer.from(s.result.data, 'base64')) }
await send('Page.enable'); await send('Runtime.enable')

// 1) Snapshot the exact persisted state
const snapshot = await evalJs(`localStorage.getItem('kurodo-watchlist')`)
// 2) Clear continueWatching only, reload
await evalJs(`(() => {
  const key = 'kurodo-watchlist'
  const raw = localStorage.getItem(key)
  if (!raw) return false
  const parsed = JSON.parse(raw)
  if (parsed.state && Array.isArray(parsed.state.continueWatching)) parsed.state.continueWatching = []
  localStorage.setItem(key, JSON.stringify(parsed))
  location.reload()
  return true
})()`)
await sleep(9000)
await evalJs(`window.scrollTo(0, 620)`)
await sleep(2500)
const st = await evalJs(`(() => {
  const a = [...document.querySelectorAll('a')].find(a => a.textContent.includes('one click away'))
  if (!a) return { found: false }
  const img = a.querySelector('img')
  const r = a.getBoundingClientRect()
  return { found: true, h: Math.round(r.height), w: Math.round(r.width), backdropLoaded: img ? img.naturalWidth > 0 : false, headline: a.querySelector('h3')?.textContent.trim().slice(0, 60) }
})()`)
console.log('STRIP:', JSON.stringify(st))
await shot('ast-after-home-emptyrail.png')

// 3) Restore the exact prior state & reload
await evalJs(`(() => { localStorage.setItem('kurodo-watchlist', ${JSON.stringify(JSON.stringify(snapshot))}); location.reload(); return true })()`)
await sleep(6000)
const restored = await evalJs(`(() => { const raw = localStorage.getItem('kurodo-watchlist'); try { return JSON.parse(raw).state.continueWatching.length } catch { return -1 } })()`)
console.log('restored continueWatching length:', restored)
ws.close()
console.log('done')
