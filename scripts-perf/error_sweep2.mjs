// Deep sweep: per-route console errors (+locations), failed/blocked request URLs.
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

let route = ''
const errors = []
const failed = []
const warnings = []
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.consoleAPICalled') {
    const type = m.params?.type
    const args = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 220)
    if (type === 'error') errors.push({ route, msg: args, url: m.params?.stackTrace?.callFrames?.[0]?.url || '', line: m.params?.stackTrace?.callFrames?.[0]?.lineNumber ?? '' })
    else if (type === 'warning') warnings.push({ route, msg: args.slice(0, 120) })
  }
  if (m.method === 'Network.loadingFailed') {
    failed.push({ route, error: m.params?.errorText, type: m.params?.type, blocked: m.params?.blockedReason, canceled: m.params?.canceled })
  }
})
await send('Runtime.enable')
await send('Network.enable')
await send('Page.enable')

const routes = ['/', '/browse', '/anime/5114', '/watch/16498?ep=1', '/search', '/schedule', '/seasonal', '/settings', '/manga', '/watchlist']
for (const r of routes) {
  route = r
  errors.length = 0
  failed.length = 0
  warnings.length = 0
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' + r })
  await sleep(r.includes('/watch') ? 9000 : 6000)
  console.log(`\n=== ${r} === errors:${errors.length} failed:${failed.length} warn:${warnings.length}`)
  for (const e of [...errors].slice(0, 5)) console.log('  ERR  ', e.msg.slice(0, 150), e.url.split('/').pop() + ':' + e.line)
  for (const f of [...new Map(failed.map(x => [x.error + x.type, x])).values()].slice(0, 6)) {
    console.log('  FAIL ', f.error, '|', f.type || '', '| blocked:', f.blocked || '-', '| canceled:', f.canceled)
  }
  for (const w of [...new Set(warnings.map(x => x.msg))].slice(0, 4)) console.log('  WARN ', w.slice(0, 120))
}
ws.close()
