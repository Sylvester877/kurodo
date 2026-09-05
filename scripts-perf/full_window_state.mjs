// Full-window screenshot + a seek to an early timestamp where the user saw the issue.
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value ?? null
}
await new Promise((r) => ws.on('open', r))

const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' })
  if (s.result?.data) { fs.writeFileSync(`screenshots/${name}.png`, Buffer.from(s.result.data, 'base64')); console.log('saved', name) }
}

// Window metrics + full page state.
const metrics = await send('Page.getLayoutMetrics')
console.log('window css:', JSON.stringify(metrics.result?.cssVisualViewport || metrics.result?.cssContentSize))

// Check ALL videos and any transform/zoom anywhere in the player tree.
const state = await evalJs(`(() => {
  const v = document.querySelector('video')
  if (!v) return { hasVideo: false }
  // walk up the tree, report every transform/scale/overflow
  const chain = []
  let el = v
  for (let i = 0; i < 8 && el; i++) {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    chain.push({
      tag: el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 3).join('.') : ''),
      rect: Math.round(r.width) + 'x' + Math.round(r.height),
      transform: cs.transform === 'none' ? 'none' : cs.transform.slice(0, 60),
      scale: cs.scale || 'unset',
      objectFit: el.tagName === 'VIDEO' ? cs.objectFit : undefined,
    })
    el = el.parentElement
  }
  return { stream: v.videoWidth + 'x' + v.videoHeight, chain }
})()`)
console.log(JSON.stringify(state, null, 2))
await shot('window-now')
ws.close()
process.exit(0)
