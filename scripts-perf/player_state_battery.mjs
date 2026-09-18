// Live player UI battery: navigate to watch, force each UI state, screenshot,
// and report DOM layout facts (control rows, overlaps, console errors).
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

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`screenshots/${name}.png`, Buffer.from(r.data, 'base64'))
  console.log('saved', name)
}

await send('Emulation.setDeviceMetricsOverride', { width: 1536, height: 960, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/5114?ep=1' })
await sleep(12000)

// DOM facts about the current player
const facts = await ev(`(() => {
  const video = document.querySelector('video')
  const wrap = video?.closest('[class*="relative"]')
  const btns = [...document.querySelectorAll('button')]
    .filter((el) => el.offsetParent && video && Math.abs(el.getBoundingClientRect().top - (video.getBoundingClientRect().top + video.getBoundingClientRect().height)) < 300)
  const vRect = video ? video.getBoundingClientRect() : null
  return {
    hasVideo: !!video,
    paused: video?.paused ?? null,
    vw: vRect ? Math.round(vRect.width) : 0, vh: vRect ? Math.round(vRect.height) : 0,
    vTop: vRect ? Math.round(vRect.top) : 0, vLeft: vRect ? Math.round(vRect.left) : 0,
    ctrlBtnText: btns.map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 26)).filter(Boolean).slice(0, 40),
    bodyH: document.body.scrollHeight,
    epTitle: (document.title || '').slice(0, 60),
  }
})()`)
console.log('PLAYER FACTS:', JSON.stringify(facts, null, 1))
await shot('player-battery-1-playing')

// force visible controls
await ev(`(() => { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); return true })()`)
await sleep(400)
await shot('player-battery-2-controls')

// paused state
await ev(`(() => { const v = document.querySelector('video'); if (v) v.pause(); return true })()`)
await sleep(300)
await shot('player-battery-3-paused')

// open settings menu
const opened = await ev(`(() => {
  const s = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').toLowerCase().includes('settings') || b.title?.toLowerCase().includes('settings'))
  if (s) { s.click(); return true }
  return false
})()`)
await sleep(400)
console.log('settings opened:', opened)
await shot('player-battery-4-settings')

ws.close()
