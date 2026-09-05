// Reproduce the user's session: open their most recent continue-watching
// show, play it, then sample live frames continuously to catch the
// detector in the act of misfiring (crop applied on real picture).
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value ?? null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await new Promise((r) => ws.on('open', r))

await send('Page.navigate', { url: 'http://localhost:5173/' })
await sleep(7000)

// Grab the first continue-watching link.
const href = await evalJs(`(() => {
  const a = [...document.querySelectorAll('a[href*="/watch/"]')]
  return a.length ? a[0].getAttribute('href') : null
})()`)
console.log('first watch link:', href)
if (!href) { console.log('no watch links found'); process.exit(1) }

await send('Page.navigate', { url: 'http://localhost:5173' + href })
await sleep(9000)

// Wait for playback.
let playing = false
for (let i = 0; i < 50; i++) {
  const st = await evalJs(`(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState, paused: v.paused, w: v.videoWidth } : null })()`)
  if (st && st.ready >= 2 && !st.paused && st.w > 0) { playing = true; console.log('playing', JSON.stringify(st)); break }
  await sleep(1000)
}
if (!playing) { console.log('no playback'); process.exit(1) }

// Sample every second for 30s: current crop state + real edge stats.
const samples = []
for (let i = 0; i < 30; i++) {
  const s = await evalJs(`(() => {
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
      const colM = []
      for (let xx = 0; xx < W; xx++) { let s2 = 0; for (let yy = 0; yy < H; yy++) s2 += lum(xx, yy); colM.push(s2 / H) }
      // std of first/last 4 columns (texture check)
      const std = (xx) => { const m = colM[xx]; let v2 = 0; for (let yy = 0; yy < H; yy++) { const l = lum(xx, yy); v2 += (l-m)*(l-m) } return Math.sqrt(v2/H) }
      edges = { l4: colM.slice(0,4).map(n=>+n.toFixed(0)), r4: colM.slice(-4).map(n=>+n.toFixed(0)), stdL: [0,1,2,3].map(n=>+std(n).toFixed(0)), stdR: [28,29,30,31].map(n=>+std(n).toFixed(0)) }
    } catch {}
    return {
      t: +v.currentTime.toFixed(0),
      boxAspect: wrap.style.aspectRatio,
      videoW: v.style.width || '-', videoLeft: v.style.left || '-',
      objectFit: getComputedStyle(v).objectFit,
      edges,
    }
  })()`)
  if (s) samples.push(s)
  await sleep(1000)
}
console.log(JSON.stringify(samples, null, 1))
const cropApplied = samples.filter((s) => s.videoW !== '-')
console.log('samples with crop applied:', cropApplied.length, '/', samples.length)
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot.result?.data) { fs.writeFileSync('screenshots/repro-session.png', Buffer.from(shot.result.data, 'base64')); console.log('saved screenshots/repro-session.png') }
ws.close()
process.exit(0)
