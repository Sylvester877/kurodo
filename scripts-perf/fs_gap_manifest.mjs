// Server-side fetch of the variant playlist via our own proxy — inspect
// EXTMAP declarations (e.g. dark-subtle DOLBY / fill hints) and segment URLs.
const B = 'http://127.0.0.1:5173'

// pull the variant URL from the live page
import WebSocket from 'ws'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
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
const r = await send('Runtime.evaluate', { expression: `performance.getEntriesByType('resource').filter(e => /m3u8/.test(e.name)).slice(-1).map(e => e.name)[0]`, returnByValue: true })
const variant = r.result?.result?.value
if (!variant) { console.log('no variant'); process.exit(1) }
console.log('variant (truncated):', variant.slice(0, 110))

// fetch it server-side (node) — it's our proxy so no CORS problem
const res = await fetch(variant)
const text = await res.text()
console.log('HTTP', res.status, '| lines:', text.split('\n').length)
console.log('--- first lines ---')
console.log(text.split('\n').slice(0, 10).join('\n'))
console.log('--- tag lines ---')
text.split('\n').filter((l) => l.startsWith('#EXT-X-MAP') || l.includes('fill') || l.includes('FILL')).slice(0, 5).forEach((l) => console.log(l.slice(0, 160)))

// grab first segment URL and probe its size vs 720p expectations
const seg = text.split('\n').find((l) => l && !l.startsWith('#'))
if (seg) {
  const segUrl = new URL(seg, variant).toString()
  const segRes = await fetch(segUrl, { headers: { Range: 'bytes=0-200000' } })
  console.log('\nfirst segment HTTP', segRes.status, '| bytes so far:', (await segRes.arrayBuffer()).byteLength)
}
process.exit(0)
