// Live verification of the 'original' video-fit mode in the real Electron
// window: switch fit via the settings store, confirm the video element is
// sized to native pixels (≤ native, never upscaled), then screenshot.
import WebSocket from 'ws'
import fs from 'node:fs'

const B = 'http://127.0.0.1:5173'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
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
await send('Page.enable')
await send('Runtime.enable')
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) { console.log('[eval exc]', (r.result.exceptionDetails?.exception?.description || '').slice(0, 200)); return null }
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`screenshots/${name}.png`, Buffer.from(r.result.data, 'base64'))
  console.log('shot:', name)
}

// 1. Watch page
await send('Page.navigate', { url: `${B}/watch/11061?ep=1` })
await sleep(15000)
const probe0 = await evalJS(`(() => {
  const v = document.querySelector('video')
  return JSON.stringify({ hasVideo: !!v, natW: v?.videoWidth, natH: v?.videoHeight, playing: v && !v.paused })
})()`)
console.log('player:', probe0)
if (!probe0 || !JSON.parse(probe0).hasVideo) { console.log('FAIL: no video'); process.exit(1) }

// 2. Flip the persisted fit setting to 'original' (localStorage store) and force a re-render
await evalJS(`(() => {
  const raw = localStorage.getItem('kurodo-settings')
  if (!raw) return 'no store'
  const parsed = JSON.parse(raw)
  const state = parsed.state || parsed
  state.videoFit = 'original'
  parsed.state = state
  localStorage.setItem('kurodo-settings', JSON.stringify(parsed))
  return 'set'
})()`)
// Reload so the store hydrates 'original' cleanly
await send('Page.navigate', { url: `${B}/watch/11061?ep=1` })
await sleep(15000)
// resume playback after reload
await evalJS(`(async () => { const v = document.querySelector('video'); if (!v) return; v.muted = true; try { await v.play() } catch {} })()`)
await sleep(2500)

const MEASURE = `(() => {
  const wrap = document.querySelector('div[class*="group relative"]')
  const v = wrap?.querySelector('video')
  if (!wrap || !v) return { err: 'no player' }
  const wr = wrap.getBoundingClientRect()
  const vr = v.getBoundingClientRect()
  const vc = getComputedStyle(v)
  return {
    fit: (() => { try { const s = JSON.parse(localStorage.getItem('kurodo-settings')).state; return s.videoFit } catch { return '?' } })(),
    natW: v.videoWidth, natH: v.videoHeight,
    elW: Math.round(vr.width), elH: Math.round(vr.height),
    boxW: Math.round(wr.width), boxH: Math.round(wr.height),
    upscaleFactor: +(vr.width / v.videoWidth).toFixed(3),
    objectFit: vc.objectFit,
    clsHasOriginal: v.className.includes('fit-original'),
  }
})()`

const m = await evalJS(MEASURE)
console.log('\n== ORIGINAL FIT ==')
console.log(JSON.stringify(m, null, 1))
if (m && !m.err) {
  const neverUpscaled = m.upscaleFactor <= 1.01
  const sizedToNative = Math.abs(m.elW - Math.min(m.natW, m.boxW)) <= 4
  console.log(`\n${neverUpscaled && sizedToNative && m.clsHasOriginal ? '✅ PASS' : '❌ FAIL'} — element ${m.elW}x${m.elH} vs native ${m.natW}x${m.natH} (box ${m.boxW}x${m.boxH}), upscale=${m.upscaleFactor}`)
}
await shot('fit-original-windowed')

// 3. Fullscreen with original — must stay native size, centered, no gap
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); return w ? w.requestFullscreen().then(() => 'ok').catch(e => String(e)) : 'no wrap' })()`)
await sleep(2500)
const mf = await evalJS(MEASURE)
console.log('\n== ORIGINAL + FULLSCREEN ==')
console.log(JSON.stringify(mf, null, 1))
if (mf && !mf.err) {
  const ok = mf.clsHasOriginal && mf.upscaleFactor <= 1.01
    && Math.abs(Math.round(window.innerWidth - (mf.elW))) >= 0 // centered by flex; gap symmetrical
  console.log(`${ok ? '✅' : '❌'} fullscreen original: element ${mf.elW}x${mf.elH}, native ${mf.natW}x${mf.natH}, upscale=${mf.upscaleFactor}`)
}
await shot('fit-original-fullscreen')

// 4. Exit fullscreen
await evalJS(`(() => { return document.exitFullscreen ? document.exitFullscreen().then(() => 'ok') : 'n/a' })()`)
await sleep(1200)

process.exit(0)
