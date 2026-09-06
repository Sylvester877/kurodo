// Verify: Related rail header (SectionHeader + count) on /watch; home still intact.
import WebSocket from 'ws'
import fs from 'node:fs'
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
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(`screenshots/${name}`, Buffer.from(s.result.data, 'base64')) }
await send('Page.enable'); await send('Runtime.enable')

// Watch page — Related rail lives below the player
await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/5114?ep=1' })
await sleep(10000)
// Scroll down toward the bottom where Related sits
await evalJs(`window.scrollTo(0, document.body.scrollHeight)`)
await sleep(4000)
const rel = await evalJs(`(() => {
  const h2 = [...document.querySelectorAll('h2')].find(h => h.textContent.trim() === 'Related')
  if (!h2) return { found: false }
  const header = h2.closest('div')?.parentElement
  const sec = h2.closest('section')
  const rail = sec?.querySelector('.overflow-x-auto')
  const countPill = header ? [...header.querySelectorAll('span')].find(s => /^\\d+$/.test(s.textContent.trim())) : null
  const arrows = sec ? [...sec.querySelectorAll('button[aria-label^="Scroll rail"]')].length : 0
  return {
    found: true,
    font: getComputedStyle(h2).fontFamily.split(',')[0],
    size: getComputedStyle(h2).fontSize,
    countPill: countPill?.textContent.trim() ?? null,
    railCards: rail ? rail.children.length : null,
    arrows,
    subtitle: header?.textContent.includes('Sequels') ?? false,
  }
})()`)
console.log('RELATED:', JSON.stringify(rel))
await shot('rail-related-header.png')

// Home sanity: header + hero height intact
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
await sleep(7000)
const home = await evalJs(`(() => {
  const h = [...document.querySelectorAll('h2')].map(x => x.textContent.trim().slice(0, 20))
  return { heroH: Math.round(document.querySelector('section').getBoundingClientRect().height), h2s: h.slice(0, 4) }
})()`)
console.log('HOME:', JSON.stringify(home))
ws.close()
console.log('done')
