// Verify the control-hiding fixes live:
//  1. Play a video, move mouse over the player, then OUT (over the black
//     gap) — controls must stay visible for >=1s (grace period).
//  2. Park the mouse ON the control bar for 4s — controls must stay visible.
//  3. Sidebar is 330px (video pushed wider on 16:10).
import WebSocket from 'ws'
import fs from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.on('open', r))
  let rid = 0
  const call = (method, params = {}) => new Promise((res, rej) => {
    const id = ++rid
    const to = setTimeout(() => rej(new Error('timeout: ' + method)), 12000)
    const onMsg = (raw) => {
      const m = JSON.parse(raw)
      if (m.id === id) { ws.off('message', onMsg); clearTimeout(to); m.result ? res(m.result) : rej(new Error(JSON.stringify(m.error || 'err'))) }
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evalJs = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
  return { ws, page, call, evalJs }
}

let { ws, page, call, evalJs } = await connect()
if (!page.url.includes('/watch/')) {
  await evalJs(`location.href = 'http://localhost:5173/watch/5114?ep=2'`).catch(() => {})
  await sleep(12000)
  ws.close()
  ;({ ws, page, call, evalJs } = await connect())
}
// Start playback muted.
for (let i = 0; i < 30; i++) {
  const st = await evalJs(`(() => { const v = document.querySelector('video'); return v ? { ready: v.readyState } : null })()`)
  if (st && st.ready >= 2) { await evalJs(`(() => { const v = document.querySelector('video'); v.muted = true; v.play().catch(()=>{}) ; return 1 })()`); break }
  await sleep(1000)
}
await sleep(3000)

const barVisible = () => evalJs(`(() => {
  const bar = document.querySelector('.pointer-events-auto.absolute.inset-x-0.bottom-0')
  if (!bar) return null
  return getComputedStyle(bar.parentElement).opacity
})()`)

// Move mouse into the player center.
await evalJs(`(() => {
  const v = document.querySelector('video')
  const r = v.getBoundingClientRect()
  const opts = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }
  v.dispatchEvent(new MouseEvent('mousemove', opts))
  v.dispatchEvent(new MouseEvent('mouseenter', opts))
  return 1
})()`)
await sleep(400)
const v1 = await barVisible()
console.log('controls after move-in:', v1)

// Leave toward the black gap (mouse-exit event).
await evalJs(`(() => {
  const v = document.querySelector('video')
  const overlay = document.querySelector('.absolute.inset-0.z-10')
  overlay.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
  return 1
})()`)
await sleep(400)
const v2 = await barVisible()
console.log('controls 0.4s after leave (grace):', v2, v2 === '1' ? '← STAYED ✓' : '← hid instantly ✗')
await sleep(1200)
const v3 = await barVisible()
console.log('controls 1.6s after leave (grace elapsed):', v3, v3 === '0' ? '← hid after grace ✓' : '← still visible')

// Come back and park ON the bar for 4s.
await evalJs(`(() => {
  const overlay = document.querySelector('.absolute.inset-0.z-10')
  overlay.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
  const bar = document.querySelector('.pointer-events-auto.absolute.inset-x-0.bottom-0')
  const r = bar.getBoundingClientRect()
  const opts = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }
  bar.dispatchEvent(new MouseEvent('mouseenter', opts))
  bar.dispatchEvent(new MouseEvent('mousemove', opts))
  return 1
})()`)
await sleep(500)
const v4 = await barVisible()
await sleep(3500)
const v5 = await barVisible()
console.log('parked on bar: visible at 0.5s:', v4, '→ at 4s:', v5, v5 === '1' ? '← STAYED ✓' : '← HID while cursor on bar ✗')

// Sidebar width check (video pushed wider).
const side = await evalJs(`(() => { const a = document.querySelector('aside'); const r = a.getBoundingClientRect(); return Math.round(r.width) })()`)
console.log('sidebar width:', side, side === 330 ? '✓ (16:10 tuned)' : '')

const shot = await call('Page.captureScreenshot', { format: 'png' })
if (shot.data) { fs.writeFileSync('screenshots/controls-fix.png', Buffer.from(shot.data, 'base64')); console.log('saved screenshots/controls-fix.png') }
ws.close()
process.exit(0)
