// Verify the watch-page player fills the screen at 1920×1200 (16:10).
// Measures the player bounding box + side margins, screenshots as proof.
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

// Resize the Electron window to the user's actual screen (1920×1200)
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1200, deviceScaleFactor: 0, mobile: false })

// Use whatever watch page is open, else navigate to a known-good one
const currentUrl = await evalJs('location.pathname + location.search')
if (!currentUrl.startsWith('/watch')) {
  await send('Page.navigate', { url: 'http://localhost:5173/watch/5114?ep=1' })
  await sleep(14000)
}

const geo = await evalJs(`(() => {
  const player = document.querySelector('[class*="aspect-video"]') ||
                 document.querySelector('video')?.closest('[class*="relative"]')
  const video = document.querySelector('video')
  const grid = document.querySelector('.grid.grid-cols-1')
  const pr = player?.getBoundingClientRect()
  const vr = video?.getBoundingClientRect()
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    player: pr ? { left: Math.round(pr.left), right: Math.round(pr.right), width: Math.round(pr.width), height: Math.round(pr.height) } : null,
    video: vr ? { left: Math.round(vr.left), width: Math.round(vr.width), height: Math.round(vr.height) } : null,
    hasVideo: !!video,
    gridMaxWidth: grid ? getComputedStyle(grid).maxWidth : null,
    sideMargin: pr ? Math.round(pr.left) : null,
    isFullscreenish: pr ? pr.width >= window.innerWidth - 60 : false,
  }
})()`)
console.log('geometry:', JSON.stringify(geo, null, 2))

fs.mkdirSync(OUT, { recursive: true })
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) fs.writeFileSync(path.join(OUT, 'watch-1920-fit.png'), Buffer.from(shot.result.data, 'base64'))

const ok = geo.sideMargin !== null && geo.sideMargin <= 40
console.log(ok ? 'PLAYER FIT: PASS ✓ (side margin ≤ 40px)' : `PLAYER FIT: margin still ${geo.sideMargin}px`)
ws.close()
process.exit(ok ? 0 : 1)
