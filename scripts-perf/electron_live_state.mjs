// Live snapshot of the Electron page + thumbnail health (no mutations).
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
const pages = list.filter((t) => t.type === 'page')
console.log(`page targets: ${pages.length}`)
for (const p of pages) console.log('  -', (p.title || 'untitled').slice(0, 50), '|', (p.url || '').slice(0, 60))

const page = pages[0]
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
  if (r.result?.exceptionDetails) return { __exc: r.result.exceptionDetails.text }
  return r.result?.result?.value
}

await send('Page.enable')
await send('Runtime.enable')

// Two samples 6s apart to catch mid-reload flapping
for (let i = 0; i < 2; i++) {
  const state = await evalJs(`(() => {
    const imgs = [...document.querySelectorAll('img')]
    let visible = 0, broken = 0, hidden = 0
    for (const img of imgs) {
      const src = img.currentSrc || img.src || ''
      if (!src || src.startsWith('data:')) continue
      const vis = img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0'
      if (vis) visible++
      else if (img.complete && img.naturalWidth === 0) broken++
      else hidden++
    }
    return {
      t: Date.now() % 100000,
      url: location.pathname,
      ready: document.readyState,
      rootLen: (document.getElementById('root')||{}).innerHTML?.length ?? -1,
      imgs: imgs.length, visible, broken, hidden,
      posters: document.querySelectorAll('.poster-frame').length,
      textLen: document.body.innerText.length,
    }
  })()`)
  console.log(`sample ${i + 1}:`, JSON.stringify(state))
  if (i === 0) await sleep(6000)
}

const final = await evalJs(`(() => {
  const imgs = [...document.querySelectorAll('img')]
  let visible = 0, broken = 0
  for (const img of imgs) {
    const src = img.currentSrc || img.src || ''
    if (!src || src.startsWith('data:')) continue
    const vis = img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0'
    if (vis) visible++
    else if (img.complete && img.naturalWidth === 0) broken++
  }
  return { imgs: imgs.length, visible, broken }
})()`)

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'electron-live-state.png'), Buffer.from(shot.result.data, 'base64'))
console.log('thumbnails:', JSON.stringify(final))
ws.close()
