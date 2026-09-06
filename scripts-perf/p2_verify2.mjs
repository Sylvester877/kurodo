// Batch-2 verification: details/browse display titles + active nav pill tint.
import WebSocket from 'ws'
import fs from 'node:fs'
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
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`screenshots/${name}`, Buffer.from(s.result.data, 'base64')) }
await send('Page.enable'); await send('Runtime.enable')

// Details page (trending #1 via direct nav; pick something likely warm: /anime/5114)
await send('Page.navigate', { url: 'http://127.0.0.1:5173/anime/5114' })
await sleep(9000)
const details = await evalJs(`(() => {
  const h1 = document.querySelector('h1')
  const navActive = [...document.querySelectorAll('nav a')].find(a => a.className.includes('text-white') && !a.textContent.includes('Search'))
  return {
    h1Text: h1?.textContent?.trim().slice(0, 40) || null,
    h1Font: h1 ? getComputedStyle(h1).fontFamily.split(',')[0] : null,
    h1Size: h1 ? getComputedStyle(h1).fontSize : null,
  }
})()`)
console.log('DETAILS:', JSON.stringify(details))
await shot('p2-details-title.png')

// Browse
await send('Page.navigate', { url: 'http://127.0.0.1:5173/browse' })
await sleep(6000)
const browse = await evalJs(`(() => {
  const h1 = document.querySelector('h1')
  const pill = [...document.querySelectorAll('nav a')].find(a => a.className.includes('text-white'))
  const pillBg = pill ? getComputedStyle(pill.querySelector('div') || pill).backgroundColor : null
  return { h1Text: h1?.textContent?.trim().slice(0, 30), h1Font: h1 ? getComputedStyle(h1).fontFamily.split(',')[0] : null }
})()`)
console.log('BROWSE:', JSON.stringify(browse))
await shot('p2-browse2.png')
ws.close()
console.log('done')
