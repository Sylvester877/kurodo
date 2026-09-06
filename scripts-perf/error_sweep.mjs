// Sweep main routes for console errors + failed HTTP requests.
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

const consoleMsgs = []
const failedReqs = []
const onConsole = (m) => {
  if (m.params?.type === 'error' || m.params?.type === 'warning') {
    const t = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 180)
    if (!/favicon|DevTools|Download the React DevTools|Autofill|source map/i.test(t)) consoleMsgs.push(`[${m.params.type}] ${t}`)
  }
}
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled') onConsole(m)
  if (m.method === 'Network.loadingFailed') failedReqs.push(m.params?.errorText + ' :: ' + (m.params?.type || ''))
})
await send('Runtime.enable')
await send('Network.enable')
await send('Page.enable')

const routes = ['/', '/browse', '/anime/5114', '/watch/16498?ep=1', '/search', '/schedule', '/seasonal', '/settings']
for (const r of routes) {
  consoleMsgs.length = 0
  failedReqs.length = 0
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' + r })
  await sleep(r.includes('/watch') ? 9000 : 6000)
  const summary = await evalJs(`(() => {
    const imgs = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).length
    return { imgs, bodyLen: document.body.textContent.length }
  })()`)
  console.log(`\n=== ${r} ===`)
  console.log('state:', JSON.stringify(summary))
  for (const c of consoleMsgs.slice(0, 6)) console.log(' ', c)
  for (const f of [...new Set(failedReqs)].slice(0, 5)) console.log('  NETFAIL:', f)
}
ws.close()
