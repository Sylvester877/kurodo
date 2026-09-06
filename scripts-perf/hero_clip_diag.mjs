// Identify hero elements overlapping the schedule ribbon region.
import WebSocket from 'ws'
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

const out = await evalJs(`(() => {
  const sec = document.querySelector('section')
  const secRect = sec.getBoundingClientRect()
  const items = []
  const low = [...sec.querySelectorAll('a, button, div')].map(el => {
    const r = el.getBoundingClientRect()
    if (r.height === 0) return null
    return { tag: el.tagName, cls: (el.className || '').toString().slice(0, 90), txt: (el.textContent || '').trim().slice(0, 25), top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }
  }).filter(Boolean).filter(x => x.bottom > 500).sort((a, b) => b.bottom - a.bottom).slice(0, 12)
  return { sectionH: Math.round(secRect.height), low }
})()`)
console.log(JSON.stringify(out, null, 1))
ws.close()
