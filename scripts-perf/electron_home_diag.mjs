// Deep-dive: why does home render an empty body in the Electron window?
// Dumps root innerHTML, console messages, failed network requests, wizard state.
import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
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
const consoleMsgs = []
const failedReqs = []
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200)
    consoleMsgs.push(`[${m.params.type}] ${text}`)
  } else if (m.method === 'Runtime.exceptionThrown') {
    consoleMsgs.push(`[EXC] ${JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '').slice(0, 250)}`)
  } else if (m.method === 'Network.loadingFailed') {
    failedReqs.push(`${m.params.errorText} ${m.params.blockedReason || ''}`)
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

await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(15000)

const info = await evalJs(`(() => ({
  url: location.href,
  readyState: document.readyState,
  rootHtmlLen: (document.getElementById('root')||{}).innerHTML?.length ?? -1,
  rootHtmlHead: (document.getElementById('root')||{}).innerHTML?.slice(0, 300) || '(no root)',
  bodyChildren: document.body.children.length,
  wizardVisible: !!document.querySelector('[data-wizard], .setup-wizard'),
  swControlled: !!navigator.serviceWorker?.controller,
  imgs: document.querySelectorAll('img').length,
  posterFrames: document.querySelectorAll('.poster-frame').length,
  visibleText: document.body.innerText.slice(0, 200).replace(/\\n+/g, ' | '),
}))()`)

console.log('PAGE STATE:', JSON.stringify(info, null, 2))
console.log('\nconsole (last 12):')
for (const c of consoleMsgs.slice(-12)) console.log('  ', c)
console.log('\nfailed requests (last 8):')
for (const f of failedReqs.slice(-8)) console.log('  ', f)

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) {
  const file = path.join(OUT, 'electron-home-diag.png')
  fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'))
  console.log('\nscreenshot:', file, `(${shot.result.data.length} bytes base64)`)
}
ws.close()
