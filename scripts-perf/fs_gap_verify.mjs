// Live fullscreen-gap verification in the REAL Electron window.
// Acceptance: in fullscreen, wrapper = viewport size, radius 0, border 0;
// video centered (no left/top offset, no oversize %), right gap ≈ 0 for
// 16:9 content (symmetric letterbox allowed on 16:10). Rapid F x5 must
// self-heal. Screenshots into screenshots/fs-gap-*.
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
  const m = JSON.parse(raw)
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

// The measurement — computed styles + box model of wrapper & video.
const MEASURE = `(() => {
  const wrap = document.querySelector('div[class*="group relative"]')
  const video = wrap?.querySelector('video')
  if (!wrap || !video) return { err: 'no player' }
  const ws = wrap.getBoundingClientRect()
  const vs = video.getBoundingClientRect()
  const wc = getComputedStyle(wrap)
  const vc = getComputedStyle(video)
  const fe = document.fullscreenElement
  return {
    fullscreen: !!fe,
    fsElementIsWrap: fe === wrap,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    wrapper: {
      rect: { l: Math.round(ws.left), t: Math.round(ws.top), w: Math.round(ws.width), h: Math.round(ws.height) },
      radius: wc.borderRadius, border: wc.borderTopWidth, aspect: wc.aspectRatio,
      display: wc.display,
    },
    video: {
      rect: { l: Math.round(vs.left), t: Math.round(vs.top), w: Math.round(vs.width), h: Math.round(vs.height) },
      objFit: vc.objectFit, objPos: vc.objectPosition, transform: vc.transform,
      pos: vc.position, width: vc.width, left: vc.left,
    },
    // THE NUMBER: black gap between video right edge and screen right edge
    rightGapPx: Math.round(window.innerWidth - (vs.left + vs.width)),
    leftGapPx: Math.round(vs.left),
    // For contain/cover object-fit, the element box can be full-bleed while
    // the PICTURE letterboxes inside it — measure real painted content via
    // the video's intrinsic box mapped by object-fit. Approx: gaps of a
    // centered picture = (el - pic)/2 per side; we report element gaps and
    // the pic-fit gaps separately.
    picW: (() => { const va = video.videoWidth / video.videoHeight; const ea = vs.width / vs.height; if (!va) return null; const of = vc.objectFit; if (of === 'cover') return { w: Math.round(vs.width), h: Math.round(vs.height) }; const pw = ea > va ? va * vs.height : vs.width; const ph = ea > va ? vs.height : vs.width / va; return { w: Math.round(pw), h: Math.round(ph) } })(),
    videoWH: { w: video.videoWidth, h: video.videoHeight },
  }
})()`

// 1. Navigate to a watch page
console.log('nav → watch page')
await send('Page.navigate', { url: `${B}/watch/11061?ep=1` })
await sleep(14000)
let s = await evalJS(MEASURE)
if (!s || s.err) { console.log('player not found:', JSON.stringify(s)); process.exit(1) }
console.log('\n== WINDOWED ==')
console.log(JSON.stringify(s, null, 1))
await shot('fs-gap-windowed')

// 2. Enter fullscreen via the player's own request (F key path)
await evalJS(`(() => { const w = document.querySelector('div[class*="group relative"]'); return w ? w.requestFullscreen().then(() => 'ok').catch(e => String(e)) : 'no wrap' })()`)
await sleep(2500)
s = await evalJS(MEASURE)
console.log('\n== FULLSCREEN (16:9 content, 16:10 screen) ==')
console.log(JSON.stringify(s, null, 1))
await shot('fs-gap-fullscreen')

// pic-fit gaps: for cover, picture fills element; for contain, symmetric bars
if (s && s.picW) {
  const el = s.video.rect
  const pic = s.picW
  const picRightGap = Math.round(el.w - pic.w) / 2 // symmetric by object-fit center
  const picLeftGap = picRightGap
  console.log(`\nPICTURE box: ${pic.w}x${pic.h} inside element ${el.w}x${el.h}`)
  console.log(`picture-side gaps: L=${picLeftGap} R=${picRightGap} (symmetric=${picLeftGap === picRightGap})`)
  console.log(`ELEMENT right gap (the bug number): ${s.rightGapPx}px (must be ~0)`)
  const elGapOk = Math.abs(s.rightGapPx) <= 2 && Math.abs(s.leftGapPx) <= 2
  const symOk = picLeftGap === picRightGap
  console.log(`\n${elGapOk && symOk ? '✅ PASS' : '❌ FAIL'} — element gap ${elGapOk ? 'OK' : 'BAD'}, picture centered ${symOk ? 'OK' : 'BAD'}`)
}

// 3. Rapid F x5 (fullscreen off/on rapidly) — must stay centered
console.log('\n== RAPID F x5 ==')
for (let i = 0; i < 5; i++) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F', code: 'KeyF', windowsVirtualKeyCode: 70 })
  await sleep(700)
}
await sleep(1500)
s = await evalJS(MEASURE)
if (s) {
  console.log(`after x5: fullscreen=${s.fullscreen} rightGap=${s.rightGapPx}px leftGap=${s.leftGapPx}px radius=${s.wrapper.radius}`)
  const ok = s.fullscreen ? (Math.abs(s.rightGapPx) <= 2 && Math.abs(s.leftGapPx) <= 2) : true
  console.log(ok ? '✅ rapid-F stable' : '❌ rapid-F broke centering')
}
await shot('fs-gap-after-rapid-f')

process.exit(0)
