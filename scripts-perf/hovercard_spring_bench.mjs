// Spring feel benchmark: teleport the mouse, then sample the floating card's
// position every ~30ms and report how many samples until it settles at target.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 })
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('kurodo-setup-done', '1')
  localStorage.setItem('kurodo-setup-shown', '1')
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await p.goto('http://localhost:5173/browse', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(7000)

const card = await p.evaluate(() => {
  const el = [...document.querySelectorAll('a[href^="/anime/"]')].find((c) => {
    const r = c.getBoundingClientRect()
    return r.width > 120 && r.top > 100 && r.bottom < innerHeight * 0.85
  })
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { left: r.left, right: r.right, y: r.top + r.height / 2 }
})
if (!card) { console.log('no card'); process.exit(1) }

async function pos() {
  return p.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      (d.className?.toString?.() || '').includes('bg-zinc-900') &&
      d.textContent.includes('Click to view details'),
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top }
  })
}

// Enter and wait for show
await p.mouse.move(card.left + 60, card.y)
await sleep(1400)
console.log('visible:', JSON.stringify(await pos()))

// Jump to a point well inside the card (80px right of entry point) so the
// qtip stays alive while we sample the spring's glide.
await p.mouse.move(card.left + 140, card.y + 5)
const samples = []
for (let i = 0; i < 12; i++) {
  samples.push(await pos())
  await sleep(30)
}
const startX = samples[0]?.left
const endX = samples[samples.length - 1]?.left
let settleIdx = samples.length - 1
for (let i = 3; i < samples.length; i++) {
  const drift = Math.abs(samples[i].left - endX)
  if (drift < 2) { settleIdx = i; break }
}
console.log('samples:', samples.map((s) => Math.round(s.left)).join(' → '))
console.log(`jump ${Math.round(Math.abs(endX - startX))}px · settled (±2px) after ~${(settleIdx + 1) * 30}ms`)
await b.close()
