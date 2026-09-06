// Measure home after Phase-1 changes: perf, fold analysis, font async status.
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
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await new Promise((r) => setTimeout(r, 8000))
await evalJs(`window.scrollTo(0,0)`)
await new Promise((r) => setTimeout(r, 3000))

const out = await evalJs(`(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const paint = performance.getEntriesByType('paint')
  const lcp = performance.getEntriesByType('largest-contentful-paint')
  const fcp = paint.find(p => p.name === 'first-contentful-paint')
  const vh = window.innerHeight
  const hero = document.querySelector('section')?.getBoundingClientRect()
  // First section header (Continue Watching rail / countdown etc.)
  const headers = [...document.querySelectorAll('h2, h3')].map(h => ({ t: h.textContent.slice(0, 30), top: Math.round(h.getBoundingClientRect().top) }))
  const fontLinks = [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].map(l => ({ rel: l.rel, as: l.as }))
  const fonts = document.fonts.status
  const usedFonts = [...new Set([...document.querySelectorAll('body *')].filter(el => el.textContent?.trim()).map(el => getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '')))]
  return {
    fcp: fcp ? Math.round(fcp.startTime) : null,
    lcp: lcp.length ? Math.round(lcp[lcp.length - 1].startTime) : null,
    dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    domNodes: document.getElementsByTagName('*').length,
    vh, heroH: hero ? Math.round(hero.height) : null,
    heroPctOfVh: hero ? Math.round((hero.height / vh) * 100) : null,
    sectionHeaders: headers.filter(h => h.top < vh).slice(0, 4),
    fontLinks, fonts,
  }
})()`)
console.log(JSON.stringify(out, null, 1))

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
fs.writeFileSync('screenshots/after-fonts-hero-home.png', Buffer.from(shot.result.data, 'base64'))
console.log('shot: screenshots/after-fonts-hero-home.png')
ws.close()
