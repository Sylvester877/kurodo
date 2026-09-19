// Manifest probe: find the active variant playlist + init segment and
// compare declared resolution vs actual decoded size.
import WebSocket from 'ws'

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
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

const urls = await evalJS(`performance.getEntriesByType('resource').filter(e => /m3u8/.test(e.name)).map(e => e.name).slice(-8)`)
console.log('m3u8 requests:')
;(urls || []).forEach((u) => console.log(' ', u.slice(0, 130)))

// fetch the last (most recent) one through the page (same-origin/proxied) and print RESOLUTION lines
const last = (urls || []).slice(-1)[0]
if (last) {
  const body = await evalJS(`fetch('${last}').then(r => r.text()).then(t => t.slice(0, 1500)).catch(e => 'ERR ' + e)`)
  console.log('\n--- manifest head ---')
  console.log(String(body).split('\n').filter((l) => /RESOLUTION|BANDWIDTH|EXT-X-STREAM|CODECS/.test(l)).join('\n'))
}

const v = await evalJS(`(() => { const v = document.querySelector('div[class*="group relative"] video'); return v ? { vw: v.videoWidth, vh: v.videoHeight } : null })()`)
console.log('\ndecoded:', JSON.stringify(v))
