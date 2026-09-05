// Screenshot the live installed-app window (CDP Page.captureScreenshot).
import WebSocket from 'ws'
import http from 'node:http'
import fs from 'node:fs'

function getJson(pathname, port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname, timeout: 3000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
}

const PORT = Number(process.env.CDP_PORT || 9223)
const OUT = process.argv[2] || 'screenshots/instapp-state.png'
const list = await getJson('/json/list', PORT)
const page = list.find((t) => t.type === 'page')
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

let msgId = 0
const pending = new Map()
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
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
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1200, deviceScaleFactor: 0, mobile: false })
await new Promise((r) => setTimeout(r, 1500))

console.log('url:', await evalJs('location.href'))
console.log('rootLen:', await evalJs("document.getElementById('root')?.innerHTML.length"))
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) {
  fs.mkdirSync('screenshots', { recursive: true })
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'))
  console.log('saved', OUT)
} else {
  console.log('screenshot failed', JSON.stringify(shot).slice(0, 200))
}
ws.close()
process.exit(0)
