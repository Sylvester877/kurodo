// In-app warm path: home → click first Trending card → how fast does details paint?
import WebSocket from 'ws'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.on('open', r))
const evalJs = async (expr) => { const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return m.result?.result?.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(9000) // let hero + first rail populate
// Click the FIRST anime card link (hero Watch Now or the first Trending rail card)
const clicked = await evalJs(`(() => {
  // Prefer a hero "Watch Now" link, else first poster link to /anime/
  const heroBtn = [...document.querySelectorAll('a')].find(a => a.textContent.includes('Watch Now') && a.getAttribute('href')?.startsWith('/anime/'))
  const first = heroBtn || [...document.querySelectorAll('a[href^="/anime/"]')].find(a => a.querySelector('img'))
  if (!first) return null
  const href = first.getAttribute('href')
  first.click()
  return href
})()`)
if (!clicked) { console.log('no card to click'); process.exit(1) }
const t0 = Date.now()
let titleMs = null
while (Date.now() - t0 < 12000) {
  await sleep(150)
  const st = await evalJs(`(() => {
    const h1 = document.querySelector('h1')
    return { title: h1?.textContent?.trim().slice(0, 50) || null, url: location.pathname }
  })()`)
  if (st.title && st.url.startsWith('/anime/') && !/unable|loading/i.test(st.title)) { titleMs = Date.now() - t0; break }
  // jumped somewhere else?
  if (st.url !== clicked) break
}
console.log(JSON.stringify({ clicked, titleMs, href: clicked }))
ws.close()
