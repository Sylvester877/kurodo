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
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(9000)
await evalJs(`window.scrollTo(0, 1300)`)
await sleep(3000)
const st = await evalJs(`(() => {
  const all = [...document.querySelectorAll('div')]
  const cls = (d) => d.className || ''
  const glass = all.filter(d => cls(d).includes('backdrop-blur-md') && cls(d).includes('border-white/25') && cls(d).includes('rounded-full')).length
  const solid = all.filter(d => (cls(d).includes('bg-primary/95') || cls(d).includes('bg-primary/90')) && cls(d).includes('rounded-full')).length
  return { glassDiscs: glass, solidDiscs: solid, scrollY: Math.round(window.scrollY), hasRecent: document.body.textContent.includes('Recent Episodes') }
})()`)
console.log('DISCS:', JSON.stringify(st))
ws.close()
