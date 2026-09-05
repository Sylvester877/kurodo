// Navigation-proof live sampler: each second, re-discover the page target
// (survives SW-update reloads), evaluate a 1-shot sample, collect in Node.
import WebSocket from 'ws'
import fs from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function withPage(fn) {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.on('open', r))
  try { return await fn(ws, page) } finally { try { ws.close() } catch {} }
}

const evalOn = (ws, expr) =>
  new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('eval timeout')), 4000)
    ws.once('message', (raw) => {
      const m = JSON.parse(raw)
      if (m.id === 1) { clearTimeout(to); m.result?.result ? res(m.result.result.value) : rej(new Error('bad eval')) }
    })
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
  })

const SAMPLE_JS = `(() => {
  const v = document.querySelector('video'); if (!v) return null
  const wrap = v.closest('[style*="aspect-ratio"]') || v.parentElement
  let edges = null
  try {
    const W = 32, H = 18
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d', { willReadFrequently: true })
    x.drawImage(v, 0, 0, W, H)
    const d = x.getImageData(0, 0, W, H).data
    const lum = (xx, yy) => { const i = (yy * W + xx) * 4; return 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2] }
    const colM = [], colMax = []
    for (let xx = 0; xx < W; xx++) { let s = 0, mx = 0; for (let yy = 0; yy < H; yy++) { const l = lum(xx, yy); s += l; if (l > mx) mx = l } colM.push(s / H); colMax.push(mx) }
    edges = { l4: colM.slice(0,4).map(n=>Math.round(n)), r4: colM.slice(-4).map(n=>Math.round(n)), maxL: colMax.slice(0,4).map(n=>Math.round(n)), maxR: colMax.slice(-4).map(n=>Math.round(n)) }
  } catch {}
  return { t: +v.currentTime.toFixed(0), box: wrap.style.aspectRatio, vW: v.style.width || '-', vL: v.style.left || '-', fit: getComputedStyle(v).objectFit, paused: v.paused, edges }
})()`

// Ensure we're on a watch page.
await withPage(async (ws, page) => {
  if (!page.url.includes('/watch/')) {
    evalOn(ws, `location.href = 'http://localhost:5173/watch/5114?ep=34'`).catch(() => {})
    await sleep(12000)
  }
})

// Wait for playback.
let ok = false
for (let i = 0; i < 40; i++) {
  try {
    const st = await withPage((ws) => evalOn(ws, `(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, paused: v.paused } : null })()`))
    if (st && st.ready >= 2 && !st.paused) { ok = true; break }
  } catch {}
  await sleep(1000)
}
console.log('playing:', ok)
if (!ok) process.exit(1)

// Sample 30x over 30s, re-connecting each time.
const samples = []
for (let i = 0; i < 30; i++) {
  try {
    const s = await withPage((ws) => evalOn(ws, SAMPLE_JS))
    if (s) samples.push(s)
  } catch (e) { console.log('sample', i, 'skipped:', e.message) }
  await sleep(1000)
}
fs.writeFileSync('screenshots/inpage-samples.json', JSON.stringify(samples, null, 1))
for (const s of samples) {
  console.log(`t=${String(s.t).padStart(4)} box=${s.box} vW=${s.vW} vL=${s.vL} fit=${s.fit} edges=${JSON.stringify(s.edges)}`)
}
const crop = samples.filter((s) => s.vW !== '-')
console.log('--- crop applied in', crop.length, 'of', samples.length, 'samples')

// Final screenshot.
try {
  await withPage(async (ws) => {
    const shot = await new Promise((res) => {
      ws.once('message', (raw) => { const m = JSON.parse(raw); if (m.id === 1) res(m.result?.result?.data) })
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
    })
    if (shot) { fs.writeFileSync('screenshots/live-after-refit.png', Buffer.from(shot, 'base64')); console.log('saved screenshots/live-after-refit.png') }
  })
} catch {}
process.exit(0)
