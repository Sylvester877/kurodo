// Distinguish real thumbnail failures from below-fold lazy images.
// Uses the Performance API to know whether the browser actually REQUESTED
// each image — never-requested lazy images are harmless. Also scrolls the
// full page and waits past the 7s self-heal retry window. Re-checks home
// with a longer settle time.
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

// Fresh home load with a generous settle
await evalJs(`(() => { try {
  localStorage.setItem('kurodo_setup_done','1');
  localStorage.setItem('kurodo-setup-complete','1');
  location.href = '/';
} catch {} return true })()`).catch(() => {})
await sleep(9000)

const scanPage = async (label) => {
  // Scroll through the WHOLE page in steps so every lazy image requests
  const height = await evalJs('document.body.scrollHeight')
  for (let y = 0; y < height; y += 700) {
    await evalJs(`window.scrollTo(0, ${y})`)
    await sleep(400)
  }
  await evalJs('window.scrollTo(0, 0)')
  // Wait past the 7s self-heal retry window
  await sleep(9000)

  const stats = await evalJs(`(() => {
    const out = { total: 0, visible: 0, broken: 0, requestedHidden: 0, neverRequested: 0, proxied: 0, problemSamples: [] }
    for (const img of document.querySelectorAll('img')) {
      const src = img.currentSrc || img.src || ''
      if (!src || src.startsWith('data:')) continue
      out.total++
      if (src.includes('/img?url=')) out.proxied++
      const vis = img.complete && img.naturalWidth > 1 && getComputedStyle(img).opacity !== '0'
      if (vis) { out.visible++; continue }
      const requested = performance.getEntriesByName(src).length > 0
      if (img.complete && img.naturalWidth === 0) {
        out.broken++
        if (out.problemSamples.length < 5) out.problemSamples.push('BROKEN ' + src.slice(0, 100))
      } else if (requested) {
        out.requestedHidden++
        if (out.problemSamples.length < 5) out.problemSamples.push('REQ-HIDDEN ' + src.slice(0, 100))
      } else {
        out.neverRequested++
      }
    }
    return out
  })()`)

  console.log(`\n=== ${label} ===`)
  console.log(`imgs: ${stats.total} | visible: ${stats.visible} | self-healed via proxy: ${stats.proxied}`)
  console.log(`broken: ${stats.broken} | requested-but-hidden: ${stats.requestedHidden} | lazy-not-yet-requested: ${stats.neverRequested}`)
  for (const s of stats.problemSamples) console.log('  ', s)

  fs.mkdirSync(OUT, { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot.result?.data) fs.writeFileSync(path.join(OUT, `electron-thumbs-${label}.png`), Buffer.from(shot.result.data, 'base64'))
  return stats
}

const home = await scanPage('home')

await evalJs(`(() => { const a=[...document.querySelectorAll('a')].find(x=>x.getAttribute('href')==='/browse'); if(a){a.click(); return 'clicked'} location.href='/browse'; return 'nav' })()`).catch(() => {})
await sleep(3500)
const browse = await scanPage('browse')

const realProblems = home.broken + browse.broken + home.requestedHidden + browse.requestedHidden
console.log('\n──────────────────────────────')
console.log(`BROKEN: ${home.broken + browse.broken}`)
console.log(`REQUESTED-BUT-HIDDEN (real failures): ${home.requestedHidden + browse.requestedHidden}`)
console.log(`LAZY NEVER REQUESTED (harmless): ${home.neverRequested + browse.neverRequested}`)
console.log(realProblems === 0 ? 'VERDICT: ALL THUMBNAILS HEALTHY ✓' : `VERDICT: ${realProblems} REAL FAILURES`)

ws.close()
process.exit(0)
