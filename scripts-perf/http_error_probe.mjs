// HTTP-error + CSP-violation probe with request URLs.
// Reports: responses >= 400 (url + status), console errors, CSP violations.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const reqUrls = new Map() // requestId -> url
const httpErrors = []
const consoleErrors = []
const csp = []
let route = ''

ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') reqUrls.set(m.params.requestId, m.params.request.url)
  if (m.method === 'Network.responseReceived') {
    const s = m.params.response?.status || 0
    if (s >= 400) {
      const u = reqUrls.get(m.params.requestId) || '?'
      if (!/favicon|\.map$/.test(u)) httpErrors.push({ route, s, u: u.slice(0, 130) })
    }
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    const t = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)
    if (!/favicon/i.test(t)) consoleErrors.push({ route, t })
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const t = m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || ''
    if (t) consoleErrors.push({ route, t: 'EXC: ' + t.slice(0, 200) })
  }
  if (m.method === 'Security.securityStateChanged') { /* n/a */ }
})

await send('Runtime.enable')
await send('Network.enable')
await send('Page.enable')

// CSP violations arrive as console messages with 'Content Security Policy' text
const cspListen = (raw) => {
  const m = JSON.parse(raw)
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 260)
    if (/Content Security Policy|Refused to/i.test(t)) csp.push({ route, t })
  }
}
ws.on('message', cspListen)
// capture consoleAPICalled errors too via second listener (the first handler ignores them except errors)

const routes = ['/', '/browse', '/anime/5114', '/watch/16498?ep=1', '/search', '/schedule', '/seasonal', '/settings', '/manga', '/watchlist', '/manga/browse', '/profile']
for (const r of routes) {
  route = r
  const before = httpErrors.length
  const c0 = consoleErrors.length
  const csp0 = csp.length
  await send('Page.navigate', { url: 'http://127.0.0.1:5173' + r })
  await sleep(r.includes('/watch') ? 9000 : 5500)
  const newHttp = httpErrors.slice(before)
  const newErr = consoleErrors.slice(c0)
  const newCsp = csp.slice(csp0)
  console.log(`\n=== ${r} === http>=400:${newHttp.length} consoleErr:${newErr.length} cspViol:${newCsp.length}`)
  const seen = new Set()
  for (const e of newHttp) {
    const k = e.s + ' ' + e.u
    if (seen.has(k)) continue
    seen.add(k)
    console.log(`  HTTP ${e.s} ${e.u}`)
  }
  for (const e of newErr.slice(0, 4)) console.log('  ERR', e.t.slice(0, 180))
  for (const c of newCsp.slice(0, 3)) console.log('  CSP', c.t.slice(0, 220))
}
ws.close()
