// After-state captures + DOM verification for the aesthetic pass.
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
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`screenshots/${name}`, Buffer.from(s.result.data, 'base64')); console.log('shot', name) }
await send('Page.enable'); await send('Runtime.enable')

// Home — cinematic empty strip (watchlist is empty in this session)
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(9000)
await evalJs(`window.scrollTo(0, 600)`)
await sleep(3000)
const strip = await evalJs(`(() => {
  const link = [...document.querySelectorAll('a')].find(a => a.className?.includes?.('group relative block rounded-2xl') && a.textContent.includes('one click away'))
  if (!link) return { found: false }
  const img = link.querySelector('img')
  const r = link.getBoundingClientRect()
  return { found: true, h: Math.round(r.height), w: Math.round(r.width), hasBackdrop: !!img && img.naturalWidth > 0, headline: link.textContent.includes('one click away') }
})()`)
console.log('STRIP:', JSON.stringify(strip))
await shot('ast-after-home-emptyrail.png')

// Details — ambient glow + colored poster shadow
await send('Page.navigate', { url: 'http://127.0.0.1:5173/anime/5114' })
await sleep(9000)
const glow = await evalJs(`(() => {
  // find hero radial glow div
  const els = [...document.querySelectorAll('div')].filter(d => d.getAttribute('aria-hidden') === 'true' && /radial-gradient/.test(d.style.background || ''))
  const poster = document.querySelector('img[alt*="Fullmetal"], img[alt*="Brotherhood"]')
  const heroImgs = [...document.images].filter(i => i.complete && i.naturalWidth > 0)
  const pShadow = poster ? poster.style.boxShadow || '' : ''
  return { glowDivs: els.length, glowSample: els[0]?.style.background.slice(0, 90) || null, posterShadow: pShadow.slice(0, 60) }
})()`)
console.log('GLOW:', JSON.stringify(glow))
await shot('ast-after-details.png')

// Card caption check on browse grid
await send('Page.navigate', { url: 'http://127.0.0.1:5173/browse' })
await sleep(8000)
const card = await evalJs(`(() => {
  const title = document.querySelector('a[href^="/anime/"] h3')
  const meta = title?.parentElement?.querySelector('p')
  return { titleSize: title ? getComputedStyle(title).fontSize : null, titleFont: title ? getComputedStyle(title).fontFamily.split(',')[0] : null, metaDots: meta ? meta.querySelectorAll('.rounded-full').length : 0, metaStars: meta ? meta.querySelectorAll('svg').length : 0 }
})()`)
console.log('CARD:', JSON.stringify(card))
await shot('ast-after-grid.png')

// 404
await send('Page.navigate', { url: 'http://127.0.0.1:5173/does-not-exist' })
await sleep(5000)
await shot('ast-after-404.png')
ws.close()
console.log('after set done')
