// Visual proof: Browse → Manga tab in the real Electron window.
// Counts manga cover <img> states: loaded vs placeholder-SVG vs broken.
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
if (!page) { console.log('no page target — is Electron running?'); process.exit(1) }
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
await send('Network.enable')
await send('Network.clearBrowserCache')

// Navigate to Browse with manga type preselected
await send('Page.navigate', { url: 'http://localhost:5173/browse?type=manga' })
await sleep(12000)

// Click the Manga tab if not already active (SPA may ignore query on first paint)
await evalJs(`(() => {
  const btns = [...document.querySelectorAll('button')]
  const mangaBtn = btns.find(b => b.textContent.trim().toLowerCase() === 'manga')
  if (mangaBtn) { mangaBtn.click(); return 'clicked' }
  return 'not-found'
})()`).catch(() => {})
await sleep(9000)

const stats = await evalJs(`(() => {
  const out = { mangaImgs: 0, loaded: 0, placeholder: 0, broken: 0, titles: 0 }
  const grid = [...document.querySelectorAll('a[href^="/manga/"]')]
  out.titles = grid.length
  for (const a of grid) {
    const img = a.querySelector('img')
    if (!img) continue
    out.mangaImgs++
    const src = img.currentSrc || img.src || ''
    if (img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0') {
      // SVG placeholder also "loads" — distinguish by natural size (our SVG is 160x90-ish scaled) or URL
      if (src.includes('/img?') && img.naturalWidth <= 160 && img.naturalHeight <= 90) out.placeholder++
      else out.loaded++
    } else if (img.complete) out.broken++
  }
  return out
})()`)
console.log('manga grid:', JSON.stringify(stats))

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'manga-grid-fixed.png'), Buffer.from(shot.result.data, 'base64'))

const ok = stats.titles > 0 && stats.placeholder === 0 && stats.broken === 0 && stats.loaded > 0
console.log(ok ? 'MANGA COVERS: PASS ✓' : 'MANGA COVERS: CHECK')
ws.close()
process.exit(ok ? 0 : 1)
