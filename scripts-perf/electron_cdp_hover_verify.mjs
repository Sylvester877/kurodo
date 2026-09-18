// Connect to the running Electron window via CDP and verify the latest build:
// hover a card on /browse inside the real app and check the aniclover card renders.
import puppeteer from 'puppeteer'
import http from 'node:http'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, timeout: 2500 }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

// Find the CDP port (Electron with remote-debugging-port=0 picks an ephemeral port)
let targets = null
for (const port of [58450, 64622]) {
  try {
    const t = await getJson(port, '/json/list')
    console.log(`port ${port}: ${t.length} target(s)`)
    if (!targets) targets = { port, list: t }
  } catch {
    console.log(`port ${port}: not CDP`)
  }
}
if (!targets) { console.log('NO CDP TARGET — relaunch Electron with --remote-debugging-port'); process.exit(1) }

const pageTarget = targets.list.find((t) => t.type === 'page')
console.log('page:', pageTarget?.title, pageTarget?.url?.slice(0, 60))

const browser = await puppeteer.connect({
  browserWSEndpoint: pageTarget.webSocketDebuggerUrl,
  defaultViewport: null,
})
const pages = await browser.pages()
const page = pages[0]

// Navigate the real app window to /browse and hover a card
await page.goto('http://localhost:5173/browse', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(7000)
const t = await page.evaluate(() => {
  const el = [...document.querySelectorAll('a[href^="/anime/"]')].find((c) => {
    const r = c.getBoundingClientRect()
    return r.width > 120 && r.top > 80 && r.bottom < innerHeight
  })
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
if (!t) { console.log('no card to hover'); process.exit(1) }
await page.mouse.move(t.x, t.y)
await sleep(1400)
const hoverOk = await page.evaluate(() =>
  [...document.querySelectorAll('div')].some((d) =>
    (d.className?.toString?.() || '').includes('bg-zinc-900') &&
    d.textContent.includes('Click to view details'),
  ),
)
console.log('hover card in real Electron window:', hoverOk ? 'OK' : 'NOT FOUND')
browser.disconnect()
process.exit(hoverOk ? 0 : 1)
