// Rescan manga grid after warm-up; final screenshot.
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

// Reload the manga page (proxy cache now warm from the previous pass)
await send('Page.navigate', { url: 'http://localhost:5173/browse?type=manga' })
await sleep(15000)

const stats = await evalJs(`(() => {
  const out = { titles: 0, mangaImgs: 0, loaded: 0, loading: 0, broken: 0, placeholder: 0 }
  for (const a of document.querySelectorAll('a[href^="/manga/"]')) {
    out.titles++
    const img = a.querySelector('img')
    if (!img) continue
    out.mangaImgs++
    const src = img.currentSrc || img.src || ''
    const vis = img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0'
    if (vis) {
      if (img.naturalWidth <= 160 && img.naturalHeight <= 90) out.placeholder++
      else out.loaded++
    } else if (img.complete && img.naturalWidth === 0) out.broken++
    else out.loading++
  }
  return out
})()`)
console.log('manga grid (warm):', JSON.stringify(stats))

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'manga-grid-warm.png'), Buffer.from(shot.result.data, 'base64'))

const ok = stats.titles > 0 && stats.placeholder === 0 && stats.broken === 0 && stats.loaded >= stats.mangaImgs * 0.8
console.log(ok ? 'MANGA GRID (WARM): PASS ✓' : 'MANGA GRID (WARM): RETRY LATER')
ws.close()
process.exit(ok ? 0 : 1)
