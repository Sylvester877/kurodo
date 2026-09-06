// Rail arrows: check render + scroll behavior on the live app.
import WebSocket from 'ws'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.on('open', r))
const evalJs = async (expr) => { const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return m.result?.result?.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(9000)
const st = await evalJs(`(() => {
  const rail = [...document.querySelectorAll('div')].find(d => d.className?.includes?.('overflow-x-auto') && d.parentElement?.textContent.includes('Continue Watching'))
  const arrows = [...document.querySelectorAll('button[aria-label*="Continue Watching"]')].map(b => b.getAttribute('aria-label'))
  const cards = rail ? rail.children.length : 0
  return { arrows, railCards: cards, railScrollable: rail ? rail.scrollWidth > rail.clientWidth : null }
})()`)
console.log('RAIL:', JSON.stringify(st))
// Click forward arrow if present, confirm scrollLeft changed
if (st.arrows.length) {
  const before = await evalJs(`document.querySelector('button[aria-label="Scroll Continue Watching forward"]')?.parentElement?.previousElementSibling?.scrollLeft ?? null`)
  await evalJs(`document.querySelector('button[aria-label="Scroll Continue Watching forward"]')?.click()`)
  await sleep(700)
  const after = await evalJs(`(() => { const rail = [...document.querySelectorAll('div')].find(d => d.className?.includes?.('overflow-x-auto') && d.parentElement?.textContent.includes('Continue Watching')); return rail?.scrollLeft ?? null })()`)
  console.log('SCROLL before/after:', before, '→', after)
}
ws.close()
