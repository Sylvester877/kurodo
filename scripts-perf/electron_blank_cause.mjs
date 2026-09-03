// Confirm the blank-home root cause: capture document request/response URLs,
// failed request URLs, SW controller info, and cache names.
import WebSocket from 'ws'
import http from 'node:http'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9222, path: pathname, timeout: 3000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
}

const list = await getJson('/json/list')
const page = list.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

let msgId = 0
const pending = new Map()
const failed = []
const docs = []
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Network.loadingFailed') failed.push(m.params)
  else if (m.method === 'Network.responseReceived') {
    const t = m.params.type
    if (t === 'Document' || t === 'Script') {
      docs.push({ type: t, url: m.params.response.url.slice(0, 110), status: m.params.response.status, fromSW: m.params.response.fromServiceWorker })
    }
  }
})
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}

await send('Page.enable')
await send('Network.enable')

await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(12000)

const state = await evalJs(`(() => ({
  rootLen: (document.getElementById('root')||{}).innerHTML?.length ?? -1,
  scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')),
  swController: navigator.serviceWorker?.controller?.scriptURL || null,
}))()`)
console.log('STATE:', JSON.stringify(state, null, 2))

console.log('\ndoc/script responses:')
for (const d of docs) console.log(`  [${d.type}] ${d.status} fromSW=${d.fromSW} ${d.url}`)
console.log('\nfailed requests:')
for (const f of failed) console.log(`  ${f.errorText} canceled=${f.canceled} type=${f.type || '?'}`)

// Check what the SW has in its caches vs what dist actually contains
const cachesInfo = await evalJs(`(async () => {
  if (!window.caches) return 'no caches API'
  const names = await caches.keys()
  const out = []
  for (const n of names) {
    const c = await caches.open(n)
    const keys = await c.keys()
    out.push({ name: n, entries: keys.length, sample: keys.slice(0, 3).map(k => k.url.slice(-60)) })
  }
  return out
})()`)
console.log('\nSW caches:', JSON.stringify(cachesInfo, null, 2))

ws.close()
