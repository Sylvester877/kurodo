import WebSocket from 'ws'
import fs from 'node:fs'
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
await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/16498?ep=1' })
await sleep(15000)
const rel = await evalJs(`(() => {
  const h2 = [...document.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Related')
  if (!h2) return { found: false, h2s: [...document.querySelectorAll('h2')].map(h => h.textContent.trim().slice(0, 24)) }
  const headerRow = h2.closest('.flex')?.parentElement
  const rail = h2.closest('section')?.querySelector('.overflow-x-auto')
  const pill = [...(h2.parentElement?.querySelectorAll('span') || [])].find(s => /^\\d+$/.test(s.textContent.trim()))
  const arrows = rail && rail.children.length > 4 ? [...rail.closest('section').querySelectorAll('button[aria-label^="Scroll rail"]')].length : 0
  return {
    found: true,
    title: h2.textContent.trim(),
    font: getComputedStyle(h2).fontFamily.split(',')[0],
    size: getComputedStyle(h2).fontSize,
    subtitle: headerRow?.textContent.includes('Sequels') ?? false,
    pill: pill?.textContent.trim() ?? null,
    railCards: rail ? rail.children.length : 0,
    arrows,
  }
})()`)
console.log('REL:', JSON.stringify(rel))
const h2 = await evalJs(`(() => { const h = [...document.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Related'); if (!h) return null; h.scrollIntoView({ block: 'center' }); return true })()`)
await sleep(1200)
const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
fs.writeFileSync('screenshots/rail-related-final.png', Buffer.from(s.result.data, 'base64'))
console.log('shot saved')
ws.close()
