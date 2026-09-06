import WebSocket from 'ws'
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
await send('Runtime.enable')
const raw = await evalJs(`localStorage.getItem('kurodo-watchlist')`)
console.log('raw len:', raw ? raw.length : null, 'head:', raw?.slice(0, 80))
// If it's double-encoded (starts with a quote), unwrap once
const unwrapped = await evalJs(`(() => {
  let raw = localStorage.getItem('kurodo-watchlist')
  if (!raw) return 'ABSENT'
  let parsed
  try { parsed = JSON.parse(raw) } catch { return 'UNPARSEABLE' }
  // If parsed is a string, it was double-encoded — unwrap
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return 'DOUBLE-UNPARSEABLE' }
    localStorage.setItem('kurodo-watchlist', JSON.stringify(parsed))
    return 'UNWRAPPED'
  }
  const cw = parsed?.state?.continueWatching
  return Array.isArray(cw) ? 'OK len=' + cw.length : 'NO-ARRAY'
})()`)
console.log('unwrapped:', unwrapped)
ws.close()
