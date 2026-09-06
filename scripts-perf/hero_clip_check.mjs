// Verify compact hero: nothing clipped, buttons visible, and real FCP/LCP via pre-nav observer.
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

await send('Page.enable')
await send('Runtime.enable')
// Inject observers BEFORE navigation so paint/LCP are captured from t=0.
await evalJs(`window.__perf = { fcp: null, lcp: null };
new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.name === 'first-contentful-paint' && !window.__perf.fcp) window.__perf.fcp = Math.round(e.startTime) } }).observe({ type: 'paint', buffered: true });
new PerformanceObserver((l) => { const es = l.getEntries(); if (es.length) window.__perf.lcp = Math.round(es[es.length - 1].startTime) }).observe({ type: 'largest-contentful-paint', buffered: true });
true`)
await send('Page.navigate', { url: 'http://127.0.0.1:5173/?perf=1' })
await new Promise((r) => setTimeout(r, 10000))
await evalJs(`window.scrollTo(0,0)`)
await new Promise((r) => setTimeout(r, 2000))

const out = await evalJs(`(() => {
  const sec = document.querySelector('section')
  const secRect = sec.getBoundingClientRect()
  const vh = window.innerHeight
  // Bottom-most interactive content inside the hero vs the schedule ribbon
  const btns = [...sec.querySelectorAll('a, button')]
  const bottomEls = btns.map(b => ({ txt: (b.textContent || '').trim().slice(0, 18), bottom: Math.round(b.getBoundingClientRect().bottom) })).sort((a, b) => b.bottom - a.bottom).slice(0, 4)
  const ribbon = [...sec.querySelectorAll('div')].find(d => d.className?.includes?.('h-14 bg-black'))
  const ribbonTop = ribbon ? Math.round(ribbon.getBoundingClientRect().top) : null
  const watchBtn = [...sec.querySelectorAll('a')].find(a => a.textContent.includes('Watch Now'))
  const wb = watchBtn ? Math.round(watchBtn.getBoundingClientRect().bottom) : null
  return {
    perf: window.__perf,
    vh, heroH: Math.round(secRect.height),
    contentBottomMax: bottomEls[0]?.bottom ?? null,
    ribbonTop, watchBtnBottom: wb,
    clipRisk: ribbonTop != null && bottomEls[0] ? bottomEls[0].bottom > ribbonTop : null,
    domNodes: document.getElementsByTagName('*').length,
    h2s: [...document.querySelectorAll('h2')].slice(0, 3).map(h => ({ t: h.textContent.slice(0, 24), top: Math.round(h.getBoundingClientRect().top) })),
  }
})()`)
console.log(JSON.stringify(out, null, 1))
ws.close()
