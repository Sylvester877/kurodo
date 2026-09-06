// Verify the new anikage-style hero + FeaturedPicks section, screenshot at 2 sizes.
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res, rej) => { const m = ++id; pending.set(m, { res, rej }); ws.send(JSON.stringify({ id: m, method, params })) })
ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result) } })
await new Promise((r) => ws.on('open', r))
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// set viewport via Emulation for 1920x1200 physical? deviceScaleFactor 1 → css 1920x1200
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1200, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(9000)

const info = await ev(`(() => {
  const txt = (el) => el?.textContent?.trim().replace(/\\s+/g, ' ') || ''
  const hero = document.querySelector('section') // first section = hero
  const heroRect = hero.getBoundingClientRect()
  const heroText = txt(hero).slice(0, 120)
  const tabButtons = [...hero.querySelectorAll('button')].map(txt).filter(Boolean).slice(0, 8)
  const pills = [...hero.querySelectorAll('span')].filter((s) => /%|Episodes|TV|Movie/i.test(txt(s)) && txt(s).length < 30).map(txt).slice(0, 8)
  const heads = [...document.querySelectorAll('h2')].map((h) => ({ t: txt(h).slice(0, 40), y: Math.round(h.getBoundingClientRect().y + scrollY) }))
  const pickPill = [...document.querySelectorAll('span')].find((s) => /EDITOR'S PICK/i.test(txt(s)))
  const card = pickPill?.closest('section')?.querySelector('a[href*="/anime/"]')
  const dots = document.querySelectorAll('button[aria-label*="pick"], button[aria-label^="Show"]').length
  const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).length
  return {
    heroH: Math.round(heroRect.height), heroText,
    tabButtons,
    metaPills: pills,
    h2s: heads.slice(0, 6),
    pickPillFound: !!pickPill, pickCardTitle: card ? txt(card).slice(0, 60) : null,
    slideDots: dots, brokenImgs: broken, totalImgs: document.images.length,
  }
})()`)
console.log(JSON.stringify(info, null, 1))
await send('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
  fs.writeFileSync('screenshots/anikage-hero-1920.png', Buffer.from(r.data, 'base64'))
  console.log('saved anikage-hero-1920.png')
})
await sleep(2000)
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false })
await sleep(4000)
await send('Page.captureScreenshot', { format: 'png' }).then(async (r) => {
  fs.writeFileSync('screenshots/anikage-hero-1366.png', Buffer.from(r.data, 'base64'))
  console.log('saved anikage-hero-1366.png')
})
ws.close()
