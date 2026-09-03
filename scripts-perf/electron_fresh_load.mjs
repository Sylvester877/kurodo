// ONE fresh load, fully instrumented: watch every request happen live.
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
const log = []
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url
    if (!u.includes('/img?') && !u.includes('anilist') && !u.includes('/api/')) log.push(`REQ  ${m.params.type} ${u.slice(0, 100)}`)
  } else if (m.method === 'Network.responseReceived') {
    const r = m.params.response
    if (!r.url.includes('/img?') && !r.url.includes('anilist') && !r.url.includes('/api/')) log.push(`RESP ${m.params.type} ${r.status} sw=${r.fromServiceWorker} ${r.url.slice(0, 100)}`)
  } else if (m.method === 'Network.loadingFailed') {
    log.push(`FAIL ${m.params.errorText} ${m.params.blockedReason || ''} type=${m.params.type}`)
  } else if (m.method === 'Runtime.exceptionThrown') {
    log.push(`EXC  ${(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 250)}`)
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    log.push(`ERR  ` + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 250))
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
await send('Runtime.enable')
await send('Network.enable')

await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__errs=[];window.addEventListener('error',e=>window.__errs.push('E:'+(e.message||e).toString().slice(0,200)+' @ '+(e.filename||'').slice(-50)+':'+e.lineno));window.addEventListener('unhandledrejection',e=>window.__errs.push('R:'+String(e.reason).slice(0,150)))`,
})
await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(13000)

const state = await evalJs(`(() => ({
  rootLen: (document.getElementById('root')||{}).innerHTML?.length ?? -1,
  errs: window.__errs || 'MISSING',
  scripts: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')),
  shellHead: document.documentElement.innerHTML.slice(0, 400),
}))()`)
console.log('=== PAGE STATE ===')
console.log(JSON.stringify(state, null, 2))
console.log('\n=== LIVE REQUEST LOG ===')
for (const l of log) console.log(l)
ws.close()
