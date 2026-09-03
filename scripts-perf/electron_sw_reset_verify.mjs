// One-shot recovery + verification for the Electron window:
//  1. Unregister SW, clear caches + HTTP cache (fixes the poisoned shell).
//  2. Hard-reload home.
//  3. Verify the React root renders and thumbnails are healthy.
//  4. Screenshot as proof.
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
await send('Runtime.enable')

// 1. Purge poisoned state
const purge = await evalJs(`(async () => {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || []
    for (const r of regs) await r.unregister()
    const names = await caches.keys()
    for (const n of names) await caches.delete(n)
    return { swUnregistered: regs.length, cachesCleared: names.length }
  } catch (e) { return { error: String(e) } }
})()`)
console.log('purge:', JSON.stringify(purge))
await send('Storage.clearDataForOrigin', { origin: 'http://localhost:5173', storageTypes: 'http_cache' })

// 2. Reload and wait for render
await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(12000)

// 3. Verify
const state = await evalJs(`(() => {
  const imgs = [...document.querySelectorAll('img')]
  let visible = 0, broken = 0, hidden = 0, proxied = 0
  for (const img of imgs) {
    const src = img.currentSrc || img.src || ''
    if (!src || src.startsWith('data:')) continue
    if (src.includes('/img?url=')) proxied++
    const vis = img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0'
    if (vis) visible++
    else if (img.complete && img.naturalWidth === 0) broken++
    else hidden++
  }
  return {
    url: location.pathname,
    rootLen: (document.getElementById('root')||{}).innerHTML?.length ?? -1,
    imgs: imgs.length, visible, broken, hidden, proxied,
    textLen: document.body.innerText.length,
    posters: document.querySelectorAll('.poster-frame').length,
    textSample: document.body.innerText.slice(0, 120).replace(/\\n+/g, ' | '),
  }
})()`)
console.log('AFTER RESET:', JSON.stringify(state, null, 2))

// 4. Screenshot
fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'electron-home-recovered.png'), Buffer.from(shot.result.data, 'base64'))

const ok = state.rootLen > 1000 && state.imgs > 0 && state.broken === 0
console.log(ok ? 'HOME RECOVERED: PASS ✓' : 'HOME RECOVERED: STILL BROKEN')
ws.close()
process.exit(ok ? 0 : 1)
