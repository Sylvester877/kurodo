// Forensic: why doesn't React mount? Log every resource response + exception,
// then fetch the entry chunk from inside the page and eval a snippet.
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
const responses = []
const exceptions = []
const consoleErrors = []
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Network.responseReceived') {
    const r = m.params.response
    responses.push({ type: m.params.type, status: r.status, url: r.url.slice(0, 100), fromSW: r.fromServiceWorker })
  } else if (m.method === 'Runtime.exceptionThrown') {
    exceptions.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 400))
  } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    consoleErrors.push(`[${m.params.type}] ` + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
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
  return { value: r.result?.result?.value, exc: r.result?.exceptionDetails?.exception?.description?.slice(0, 300) }
}

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

// Capture window errors BEFORE app code runs: navigate to blank, then inject via
// Page.addScriptToEvaluateOnNewDocument
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__errs = []; window.addEventListener('error', e => window.__errs.push(String(e.message||e).slice(0,300) + ' @ ' + String(e.filename||'').slice(-60) + ':' + e.lineno)); window.addEventListener('unhandledrejection', e => window.__errs.push('REJ: ' + String(e.reason).slice(0,200)));`,
})
await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(14000)

const state = await evalJs(`(() => ({
  rootLen: (document.getElementById('root')||{}).innerHTML?.length ?? -1,
  errs: window.__errs || ['(marker missing)'],
  scripts: [...document.querySelectorAll('script[src]')].map(s => s.src.slice(-40)),
  swc: navigator.serviceWorker?.controller?.scriptURL || null,
}))()`)
console.log('STATE:', JSON.stringify(state, null, 2))

// In-page fetch of the entry chunk
const entry = state.scripts.find((s) => s.includes('index-')) || state.scripts[0]
const fetchTest = await evalJs(`(async () => {
  try {
    const r = await fetch('/assets/${entry}', { cache: 'no-store' })
    const t = await r.text()
    return { status: r.status, bytes: t.length, head: t.slice(0, 80), mime: r.headers.get('content-type') }
  } catch (e) { return { error: String(e) } }
})()`)
console.log('\nentry chunk fetch:', JSON.stringify(fetchTest))

console.log(`\nresponses (${responses.length}):`)
for (const r of responses.slice(0, 20)) console.log(`  [${r.type}] ${r.status} sw=${r.fromSW} ${r.url}`)
console.log(`\nexceptions (${exceptions.length}):`)
for (const e of exceptions.slice(0, 8)) console.log('  ', e.split('\n')[0])
console.log(`\nconsole errors/warnings (${consoleErrors.length}):`)
for (const c of consoleErrors.slice(0, 8)) console.log('  ', c.split('\n')[0])

ws.close()
