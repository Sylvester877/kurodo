// Scan the REAL Electron window for broken/missing thumbnails via raw CDP.
// Checks: home + browse pages. For every <img>:
//   • broken    — complete && naturalWidth === 0 (failed and never recovered)
//   • invisible — decoded but opacity-0 (stuck pre-fade, our new pipeline
//                 should have retried these via /img)
//   • proxied   — recovered through the self-heal /img proxy
// Screenshots both pages into screenshots/electron-thumbs-*.png
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
console.log('window:', page.title || '(untitled)', '·', (page.url || '').slice(0, 60))

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

let msgId = 0
const pending = new Map()
const events = []
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method) events.push(m)
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

// Dismiss first-run wizard if present (Electron profile may be fresh)
await evalJs(`(() => { try {
  localStorage.setItem('kurodo_setup_done','1');
  localStorage.setItem('kurodo-setup-complete','1');
  location.href = '/';
} catch {} return true })()`).catch(() => {})
await sleep(2500)

const scan = async (label) => {
  events.length = 0
  const stats = await evalJs(`(async () => {
    await new Promise(r => setTimeout(r, 6000)) // let lazy imgs + retries settle
    const out = { total: 0, visible: 0, broken: 0, stuckHidden: 0, proxied: 0, samples: [] }
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || ''
      if (!src || src.startsWith('data:')) continue
      out.total++
      const isProxy = src.includes('/img?url=')
      if (isProxy) out.proxied++
      const vis = img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0'
      if (vis) { out.visible++; continue }
      if (img.complete && img.naturalWidth === 0) {
        out.broken++
        if (out.samples.length < 6) out.samples.push('BROKEN ' + src.slice(0, 100))
      } else if (getComputedStyle(img).opacity === '0') {
        out.stuckHidden++
        if (out.samples.length < 6) out.samples.push('HIDDEN ' + src.slice(0, 100))
      }
    }
    return out
  })()`)
  console.log(`\n=== ${label} ===`)
  console.log(`imgs: ${stats.total} | visible: ${stats.visible} | proxied(self-healed): ${stats.proxied} | broken: ${stats.broken} | stuck-hidden: ${stats.stuckHidden}`)
  for (const s of stats.samples) console.log('  ', s)
  fs.mkdirSync(OUT, { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) fs.writeFileSync(path.join(OUT, `electron-thumbs-${label}.png`), Buffer.from(shot.result.data, 'base64'))
  return stats
}

const home = await scan('home')

// Navigate to browse via SPA
await evalJs(`(() => { const a=[...document.querySelectorAll('a')].find(x=>x.getAttribute('href')==='/browse'); if(a){a.click(); return 'clicked'} location.href='/browse'; return 'nav' })()`).catch(() => {})
await sleep(3000)
await evalJs('window.scrollTo(0, 1800)').catch(() => {})
const browse = await scan('browse')

console.log('\nVERDICT:', (home.broken + browse.broken) === 0 ? 'NO BROKEN THUMBNAILS ✓' : `BROKEN THUMBNAILS REMAIN (${home.broken + browse.broken})`)
console.log('VERDICT:', (home.stuckHidden + browse.stuckHidden) < 5 ? 'NO STUCK-POSTER GRID ✓' : 'SOME STUCK-HIDDEN (may be below-fold lazy)')

ws.close()
process.exit(0)
