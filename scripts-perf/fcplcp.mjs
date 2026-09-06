// Clean FCP/LCP/DCL: inject observers into every new document, then navigate.
import WebSocket from 'ws'
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

await send('Page.enable')
await send('Runtime.enable')
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__perf = { fcp: null, lcp: null, lcpEl: null, dcl: null }
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint' && !window.__perf.fcp) window.__perf.fcp = Math.round(e.startTime) }).observe({ type: 'paint' })
  new PerformanceObserver((l) => { const es = l.getEntries(); if (es.length) { const last = es[es.length - 1]; window.__perf.lcp = Math.round(last.startTime); window.__perf.lcpEl = (last.element?.tagName || '') + '.' + ((last.element?.className || '').toString().slice(0, 40)) } }).observe({ type: 'largest-contentful-paint' })
  addEventListener('DOMContentLoaded', () => { window.__perf.dcl = Math.round(performance.now()) })
` })

await send('Page.navigate', { url: 'http://127.0.0.1:5173/?p=2' })
// Poll until LCP settles (max ~20s)
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  const done = await evalJs(`(() => { const p = window.__perf; return p.lcp ? p : null })()`)
  if (done) break
}
await new Promise((r) => setTimeout(r, 2500))
const out = await evalJs(`(() => {
  const p = window.__perf
  const res = performance.getEntriesByType('resource')
  const js = res.filter(r => r.initiatorType === 'script' || r.name.includes('/assets/')).reduce((a, r) => a + (r.transferSize || 0), 0)
  const css = res.filter(r => r.name.endsWith('.css')).reduce((a, r) => a + (r.transferSize || 0), 0)
  const imgs = res.filter(r => r.initiatorType === 'img').length
  const hero = document.querySelector('section')
  return {
    fcp: p.fcp, lcp: p.lcp, lcpEl: p.lcpEl, dcl: p.dcl,
    jsBytes: js, cssBytes: css, imageRequests: imgs,
    domNodes: document.getElementsByTagName('*').length,
    heroH: hero ? Math.round(hero.getBoundingClientRect().height) : null,
    cwTitle: (() => { const h = [...document.querySelectorAll('h2')].find(h => /continue|recent|trending/i.test(h.textContent)); return h ? { t: h.textContent.slice(0, 30), top: Math.round(h.getBoundingClientRect().top), belowFold: h.getBoundingClientRect().top > innerHeight } : null })(),
    vh: innerHeight,
  }
})()`)
console.log(JSON.stringify(out, null, 1))
ws.close()
