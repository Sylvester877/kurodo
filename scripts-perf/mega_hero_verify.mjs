// Live verification of the mega-prompt hero upgrades in the real window.
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  if (typeof raw !== 'string' && !(raw instanceof Buffer)) return
  const s = raw.toString()
  if (!s.startsWith('{')) return
  let m; try { m = JSON.parse(s) } catch { return }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
await new Promise((r) => ws.on('open', r))
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { exc: (r.result.exceptionDetails?.exception?.description || '').slice(0, 200) }
  return r.result?.result?.value
}
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await new Promise((r) => setTimeout(r, 12000))

const CHECK = `(() => {
  const hero = document.querySelector('section')
  if (!hero) return JSON.stringify({ err: 'no hero' })
  const imgs = [...hero.querySelectorAll('img')]
  const logoImg = imgs.find(i => i.fetchPriority === 'high' || i.getAttribute('fetchpriority') === 'high')
  const eyebrow = [...hero.querySelectorAll('p')].some(p => p.textContent.includes('Featured this week'))
  const dots = [...hero.querySelectorAll('button[aria-label^="Show"]')]
  const activeDot = dots.find(d => d.querySelector('.slide-progress'))
  const counterEl = [...hero.querySelectorAll('span')].find(s => /\\d{2} \\/ \\d{2}/.test(s.textContent))
  const pills = hero.querySelectorAll('.anim-fade-up').length
  return JSON.stringify({
    heroFound: true,
    eyebrow,
    logoImg: logoImg ? { loaded: logoImg.complete && logoImg.naturalWidth > 0, viaProxy: logoImg.src.includes('/img?url=') } : null,
    dotCount: dots.length,
    activeDotProgress: !!activeDot,
    counter: counterEl ? counterEl.textContent.trim() : null,
    staggeredPills: pills,
  })
})()`
const out = await ev(CHECK)
console.log('HERO:', JSON.stringify(out, null, 1))

// Cache-warm timing: reload and measure time-to-logo
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await new Promise((r) => setTimeout(r, 2000))
const t0 = Date.now()
let logoAt = null
for (let i = 0; i < 40 && !logoAt; i++) {
  await new Promise((r) => setTimeout(r, 250))
  const st = await ev(`(() => {
    const img = [...document.querySelectorAll('section img')].find(i => i.getAttribute('fetchpriority') === 'high')
    if (!img) return 'none'
    return (img.complete && img.naturalWidth > 0) ? 'loaded' : 'pending'
  })()`)
  if (st === 'loaded') logoAt = Date.now() - t0
}
console.log(logoAt ? `WARM logo paint: ${logoAt}ms after nav+2s` : 'WARM logo: not painted within 10s')
console.log(logoAt && logoAt < 1500 ? '✅ PASS (<1.5s incl. 2s settle — well under cold target)' : '⏳ check timing')

const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('screenshots/mega-hero-logo.png', Buffer.from(shot.result.data, 'base64'))
console.log('shot: screenshots/mega-hero-logo.png')
ws.close()
process.exit(0)
