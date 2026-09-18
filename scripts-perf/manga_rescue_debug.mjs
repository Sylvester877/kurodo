// Debug why the atsu rescue didn't replace the notice page in the live reader.
import WebSocket from 'ws'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
let id = 0
const pending = new Map()
const logs = []
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled') {
    const txt = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ')
    logs.push(`[${m.params.type}] ${txt}`)
  }
  if (m.method === 'Runtime.exceptionThrown') {
    logs.push(`[EXC] ${m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text}`)
  }
})
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
await new Promise((r) => ws.on('open', r))
await send('Runtime.enable')
await send('Page.enable')

const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) { console.log('[eval exc]', r.result.exceptionDetails?.exception?.description?.slice(0, 200)); return null }
  return r.result?.result?.value
}

// Reload the reader page fresh and watch
const B = 'http://127.0.0.1:5173'
await send('Page.navigate', { url: `${B}/manga/read/20303093-bc0e-4f6d-9527-8a275a39ef5d?manga=aa6c76f7-5f5f-46b6-a800-911145f81b9b&source=mangadex` })

// poll every 3s for up to 30s
for (let i = 1; i <= 10; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  const expr = "(() => { const imgs = [...document.querySelectorAll('img')]; const loaded = imgs.filter(i2 => i2.complete && i2.naturalWidth > 0); return { n: imgs.length, loaded: loaded.length, src: (imgs[0] && imgs[0].src ? imgs[0].src.slice(0, 90) : null), rescueBadge: document.body.innerText.includes('atsu.moe') } })()"
  const s = await evalJS(expr)
  if (!s) { continue }
  console.log(`t+${i * 3}s:`, JSON.stringify(s))
  if (s.rescueBadge || (s.src && !/mangadex\.network/.test(s.src))) { console.log('>>> rescue landed'); break }
}

console.log('--- console tail ---')
logs.slice(-25).forEach(l => console.log(l))
process.exit(0)
