// Focused recheck of the Electron home page (previous scan caught it mid-load).
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
await send('Runtime.enable')

// Hard-navigate home and wait properly
await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(12000)

const info = await evalJs(`(() => {
  const imgs = [...document.querySelectorAll('img')]
  let visible = 0, broken = 0, hidden = 0, proxied = 0
  const samples = []
  for (const img of imgs) {
    const src = img.currentSrc || img.src || ''
    if (!src || src.startsWith('data:')) continue
    if (src.includes('/img?url=')) proxied++
    const vis = img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0'
    if (vis) visible++
    else if (img.complete && img.naturalWidth === 0) { broken++; if (samples.length < 5) samples.push(src.slice(0, 90)) }
    else hidden++
  }
  return {
    url: location.pathname,
    title: document.title,
    totalImgs: imgs.length,
    visible, broken, hidden, proxied, samples,
    bodyLen: document.body.innerText.length,
    hasPosters: document.querySelectorAll('.poster-frame').length,
  }
})()`)

console.log(JSON.stringify(info, null, 2))

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'electron-thumbs-home-recheck.png'), Buffer.from(shot.result.data, 'base64'))
console.log(info.broken === 0 ? 'HOME: NO BROKEN ✓' : `HOME: ${info.broken} BROKEN`)
ws.close()
