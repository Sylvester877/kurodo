import WebSocket from 'ws'
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
await send('Page.enable'); await send('Runtime.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/16498?ep=1' }) // Steins;Gate — bigger franchise set
for (let i = 0; i < 6; i++) {
  await sleep(5000)
  const st = await evalJs(`(() => {
    const txt = document.body.textContent
    return {
      h1ish: [...document.querySelectorAll('h1,h2')].slice(0, 3).map(h => h.textContent.trim().slice(0, 30)),
      hasRelatedTitle: txt.includes('Related'),
      railExists: !!document.querySelector('.overflow-x-auto'),
      scrollH: document.documentElement.scrollHeight,
      errNote: /fetching server|no stream|couldn/i.test(txt.slice(0, 2000)) ? txt.slice(0, 120) : null,
    }
  })()`)
  console.log(i, JSON.stringify(st))
  if (st.hasRelatedTitle) break
}
ws.close()
