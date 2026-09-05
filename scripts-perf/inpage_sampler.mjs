// In-page sampler: install collector inside the page (immune to CDP hiccups),
// wait, then read results once.
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

// If we're not on a watch page, go to the user's show.
if (!page.url.includes('/watch/')) {
  await send('Page.navigate', { url: 'http://localhost:5173/watch/5114?ep=34' })
  await sleep(12000)
}

await evalJs(`(() => {
  window.__samples = []
  window.__sampler = setInterval(() => {
    const v = document.querySelector('video'); if (!v) return
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
      for (let xx = 0; xx < W; xx++) { let s = 0; for (let yy = 0; yy < H; yy++) s += lum(xx, yy); colM.push(s / H) }
      const std = (xx) => { const m = colM[xx]; let v2 = 0; for (let yy = 0; yy < H; yy++) { const l = lum(xx, yy); v2 += (l-m)*(l-m) } return Math.sqrt(v2/H) }
      edges = { l4: colM.slice(0,4).map(n=>Math.round(n)), r4: colM.slice(-4).map(n=>Math.round(n)), stdL: [0,1,2,3].map(n=>Math.round(std(n))), stdR: [28,29,30,31].map(n=>Math.round(std(n))) }
    } catch {}
    window.__samples.push({
      t: +v.currentTime.toFixed(0),
      box: wrap.style.aspectRatio,
      vW: v.style.width || '-', vL: v.style.left || '-',
      fit: getComputedStyle(v).objectFit, paused: v.paused,
      edges,
    })
  }, 1000)
  return 'installed'
})()`)

await sleep(35000)
const samples = await evalJs(`(() => { clearInterval(window.__sampler); return window.__samples })()`)
fs.writeFileSync('screenshots/inpage-samples.json', JSON.stringify(samples, null, 1))
// Compact print
for (const s of samples || []) {
  console.log(`t=${String(s.t).padStart(4)} box=${s.box} vW=${s.vW} vL=${s.vL} fit=${s.fit} edges=${JSON.stringify(s.edges)}`)
}
const crop = (samples || []).filter((s) => s.vW !== '-')
console.log('--- crop applied in', crop.length, 'of', (samples || []).length, 'samples')
ws.close()
process.exit(0)
