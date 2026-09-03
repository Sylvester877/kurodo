// Final check inside the REAL Electron window (via raw CDP page target):
// latest bundle live + hover card follows the cursor in-app.
import WebSocket from 'ws'
import http from 'node:http'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port: 9222, path, timeout: 3000 },
      (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => resolve(JSON.parse(d)))
      },
    )
    req.on('error', reject)
  })
}

const list = await getJson('/json/list')
const page = list.find((t) => t.type === 'page')
if (!page) { console.log('no page target'); process.exit(1) }
console.log('window:', page.title, '·', (page.url || '').slice(0, 50))

const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej) })

let msgId = 0
const pending = new Map()
ws.on('message', (data) => {
  const m = JSON.parse(data.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) console.log('eval exception:', r.result.exceptionDetails.text)
  return r.result?.result?.value
}

await send('Page.enable')
await send('Page.navigate', { url: 'http://localhost:5173/browse' })
await sleep(9000)

const card = await evaluate(`(() => {
  const el = [...document.querySelectorAll('a[href^="/anime/"]')].find((c) => {
    const r = c.getBoundingClientRect()
    return r.width > 120 && r.top > 80 && r.bottom < innerHeight * 0.9
  })
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, y: r.top + r.height / 2 }
})()`)
if (!card) { console.log('no cards — page not loaded?'); process.exit(1) }

async function hoverCardLeft() {
  return evaluate(`(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      (d.className?.toString?.() || '').includes('bg-zinc-900') &&
      d.textContent.includes('Click to view details'),
    )
    return el ? Math.round(el.getBoundingClientRect().left) : null
  })()`)
}

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.left + 60, y: card.y })
await sleep(1300)
const a = await hoverCardLeft()
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.right - 40, y: card.y })
await sleep(400)
const b = await hoverCardLeft()

console.log('hover card left @ entry :', a)
console.log('hover card left @ right :', b)
const follow = a != null && b != null && Math.abs(b - a) > 10
console.log(follow ? 'PASS: latest build live in Electron — hover card follows cursor' : 'FAIL: follow check failed')
process.exit(follow ? 0 : 1)
