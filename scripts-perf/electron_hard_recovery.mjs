// Clear Electron's HTTP cache (Network.clearBrowserCache) + hard reload,
// then verify the app mounts and thumbnails render.
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
await send('Network.enable')
await send('Runtime.enable')

console.log('clearing browser cache…')
await send('Network.clearBrowserCache')
await send('Storage.clearDataForOrigin', { origin: 'http://localhost:5173', storageTypes: 'http_cache, service_workers, cache_storage' })

await send('Page.reload', { ignoreCache: true })
await sleep(14000)

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
    entry: [...document.querySelectorAll('script[src]')].map(s => s.getAttribute('src')).find(s => s.includes('index-')),
    imgs: imgs.length, visible, broken, hidden, proxied,
    posters: document.querySelectorAll('.poster-frame').length,
    textSample: document.body.innerText.slice(0, 100).replace(/\\n+/g, ' | '),
  }
})()`)
console.log('AFTER HARD RESET:', JSON.stringify(state, null, 2))

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'electron-home-final.png'), Buffer.from(shot.result.data, 'base64'))

const ok = state.rootLen > 1000 && state.imgs > 0 && state.broken === 0
console.log(ok ? 'RECOVERY: PASS ✓' : 'RECOVERY: STILL BROKEN')
ws.close()
process.exit(ok ? 0 : 1)
