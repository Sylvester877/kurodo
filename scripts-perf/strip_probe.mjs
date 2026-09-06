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
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(9000)
const out = await evalJs(`(() => {
  const bodyText = document.body.textContent
  const emptyOld = bodyText.includes('Nothing to continue')
  const emptyNew = bodyText.includes('one click away')
  const links = [...document.querySelectorAll('a')].slice(0, 40).map(a => a.textContent.trim().slice(0, 40))
  const ls = (() => { try { return localStorage.getItem('kurodo-watchlist')?.slice(0, 120) || 'EMPTY' } catch { return 'ERR' } })()
  return { emptyOld, emptyNew, linksSample: links.slice(15, 30), watchlistLS: ls }
})()`)
console.log(JSON.stringify(out, null, 1))
ws.close()
