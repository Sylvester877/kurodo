// P2 batch verification: search pill, display font swap, grid density; screenshots.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`screenshots/${name}`, Buffer.from(s.result.data, 'base64')) }

await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(9000)

const home = await evalJs(`(() => {
  const pill = [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Search anime') && b.querySelector('svg'))
  const h2 = [...document.querySelectorAll('h2')].find(h => h.textContent.trim().length > 2)
  const font = h2 ? getComputedStyle(h2).fontFamily.split(',')[0] : null
  const grid = document.querySelector('.grid')
  const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null
  return { pillFound: !!pill, pillText: pill?.textContent.trim().slice(0, 40), h2Font: font, gridCols: cols, scrollY: window.scrollY }
})()`)
console.log('HOME:', JSON.stringify(home))
await shot('p2-home-abovefold.png')

// Scroll to feed + capture, hover a card for the new overlay
await evalJs(`window.scrollTo(0, 950)`)
await sleep(2500)
const feed = await evalJs(`(() => {
  const grid = [...document.querySelectorAll('.grid')].filter(g => getComputedStyle(g).gridTemplateColumns.split(' ').length >= 7)[0]
  const cols = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : null
  const h2s = [...document.querySelectorAll('h2')].slice(0, 5).map(h => ({ t: h.textContent.slice(0, 24), f: getComputedStyle(h).fontFamily.split(',')[0], fs: getComputedStyle(h).fontSize }))
  return { cols, h2s }
})()`)
console.log('FEED:', JSON.stringify(feed))
await shot('p2-home-feed.png')

// Hover the first card to trigger overlay; screenshot
await evalJs(`(() => { const a = document.querySelector('a[href^="/anime/"]'); const r = a.getBoundingClientRect(); a.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true })); window.__hx = r.x + r.width / 2; window.__hy = r.y + r.height / 2 })()`)
await evalJs(`(() => { const a = document.querySelector('a[href^="/anime/"]'); ['mouseover','mousemove'].forEach(t => a.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: window.__hx, clientY: window.__hy }))) })()`)
await sleep(700)
await shot('p2-card-hover.png')

// Browse page
await send('Page.navigate', { url: 'http://127.0.0.1:5173/browse' })
await sleep(7000)
const browse = await evalJs(`(() => ({ h1: document.querySelector('h1')?.textContent?.trim().slice(0, 40) || null, cards: document.querySelectorAll('a[href^="/anime/"] img').length }))()`)
console.log('BROWSE:', JSON.stringify(browse))
await shot('p2-browse.png')
ws.close()
console.log('shots done')
