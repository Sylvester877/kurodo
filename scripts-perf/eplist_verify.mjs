// Verify the redesigned episode list in the live app:
//  - header has range dropdown + paging + filter + eye toggle
//  - rows are the new style: EP badge, title, synopsis, CC/score/date
//  - NO transform/scale on row hover (checked computed style while hovering)
//  - screenshot the sidebar
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
console.log('url:', page.url)
if (!page.url.includes('/watch/')) {
  await evalJs(`location.href = 'http://localhost:5173/watch/5114?ep=2'`).catch(() => {})
  await sleep(12000)
  ws.close()
  ;({ ws, page, call, evalJs } = await connect())
  console.log('url now:', page.url)
}

// Header checks.
const header = await evalJs(`(() => {
  const aside = document.querySelector('aside')
  if (!aside) return { hasAside: false }
  return {
    hasAside: true,
    hasRangeSelect: !!aside.querySelector('select[aria-label="Episode range"]'),
    hasPaging: aside.querySelectorAll('button[aria-label="Previous range"], button[aria-label="Next range"]').length,
    hasFilter: !![...aside.querySelectorAll('input')].find((i) => i.placeholder === 'Filter episodes…'),
    hasEyeToggle: !!aside.querySelector('button[title="Hide watched episodes"], button[title="Show all episodes"]'),
    rangeOptions: aside.querySelector('select[aria-label="Episode range"]') ? [...aside.querySelector('select').options].slice(0, 3).map((o) => o.text) : null,
  }
})()`)
console.log('header:', JSON.stringify(header, null, 2))

// Row structure checks.
const rows = await evalJs(`(() => {
  const aside = document.querySelector('aside')
  const rowBtns = [...aside.querySelectorAll('button')].filter((b) => b.querySelector('img') && /EP \\d/.test(b.textContent))
  return rowBtns.slice(0, 4).map((b) => {
    const img = b.querySelector('img')
    const hasEpBadge = /EP \\d/.test(b.textContent)
    const hasScore = /\\d\\.\\d\\d/.test(b.textContent)
    const hasDate = /(19|20)\\d\\d/.test(b.textContent)
    const hasCC = b.textContent.includes('CC')
    const hasSynopsis = (b.textContent || '').length > 60
    return { ep: (b.textContent.match(/EP (\\d+)/) || [])[1], hasEpBadge, hasScore, hasDate, hasCC, hasSynopsis, imgOk: img && img.complete && img.naturalWidth > 0 }
  })
})()`)
console.log('rows:', JSON.stringify(rows, null, 1))

// Hover check: dispatch mouseover on row 2, read computed transform.
const hover = await evalJs(`(() => {
  const aside = document.querySelector('aside')
  const row = [...aside.querySelectorAll('button')].filter((b) => b.querySelector('img'))[1]
  if (!row) return null
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
  return new Promise((res) => setTimeout(() => {
    const cs = getComputedStyle(row)
    const img = row.querySelector('img')
    res({ rowTransform: cs.transform, rowScale: cs.scale, imgTransform: getComputedStyle(img).transform, imgScale: getComputedStyle(img).scale })
  }, 350))
})()`)
console.log('hover state:', JSON.stringify(hover))

// Screenshot the aside.
const rect = JSON.parse(await evalJs(`(() => { const r = document.querySelector('aside').getBoundingClientRect(); return JSON.stringify({ x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 600), height: Math.min(r.height, 1100) }) })()`))
const shot = await call('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } })
if (shot.data) { fs.writeFileSync('screenshots/eplist-new.png', Buffer.from(shot.data, 'base64')); console.log('saved screenshots/eplist-new.png') }
ws.close()
process.exit(0)
