// Phase-0 baseline: perf metrics + screenshots + above-the-fold analysis of Home.
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.on('open', r))

const evalJs = async (expr) => { const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return m.result?.result?.value }

// Reload fresh so perf entries are clean
await send('Page.enable')
await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await new Promise((r) => setTimeout(r, 9000))
await evalJs(`window.scrollTo(0,0)`)
await new Promise((r) => setTimeout(r, 2500))

// Clear + re-collect paint timings
await evalJs(`performance.clearResourceTimings()`)

const metrics = await evalJs(`(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const paint = performance.getEntriesByType('paint')
  const lcp = performance.getEntriesByType('largest-contentful-paint')
  const fcp = paint.find(p => p.name === 'first-contentful-paint')
  const dcl = nav ? nav.domContentLoadedEventEnd : null
  const load = nav ? nav.loadEventEnd : null
  const res = performance.getEntriesByType('resource')
  const bytes = res.reduce((a, r) => a + (r.transferSize || 0), 0)
  const js = res.filter(r => r.initiatorType === 'script' || r.name.endsWith('.js')).reduce((a, r) => a + (r.transferSize || 0), 0)
  const css = res.filter(r => r.name.endsWith('.css')).reduce((a, r) => a + (r.transferSize || 0), 0)
  const img = res.filter(r => r.initiatorType === 'img').reduce((a, r) => a + (r.transferSize || 0), 0)
  return {
    fcp: fcp ? Math.round(fcp.startTime) : null,
    lcp: lcp.length ? Math.round(lcp[lcp.length - 1].startTime) : null,
    dcl: dcl ? Math.round(dcl) : null,
    load: load ? Math.round(load) : null,
    domNodes: document.getElementsByTagName('*').length,
    totalBytes: bytes, jsBytes: js, cssBytes: css, imgBytes: img,
    hero: document.querySelector('section')?.getBoundingClientRect().height ?? null,
    vh: window.innerHeight,
  }
})()`)

console.log(JSON.stringify(metrics, null, 1))

// Which content is visible without scrolling?
const fold = await evalJs(`(() => {
  const vh = window.innerHeight
  const out = {}
  const grab = (sel, name) => {
    const el = document.querySelector(sel)
    if (!el) return
    const r = el.getBoundingClientRect()
    out[name] = { top: Math.round(r.top), bottom: Math.round(r.bottom), visible: r.top < vh && r.bottom > 0 }
  }
  grab('section', 'hero')
  out.tabs = [...document.querySelectorAll('section button')].slice(0, 6).map(b => b.textContent)
  return out
})()`)
console.log('FOLD:', JSON.stringify(fold))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
fs.writeFileSync('screenshots/baseline-home.png', Buffer.from(shot.result.data, 'base64'))
console.log('shot saved: screenshots/baseline-home.png')
ws.close()
