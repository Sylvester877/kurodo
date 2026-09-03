// Verify cursor-following: hover a card, move mouse to 3 spots, sample the
// floating card's left/top each time. A follower's position must track the
// cursor; an anchored card's position never changes.
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
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, right: r.right }
})
if (!card) { console.log('no card'); process.exit(1) }

async function floatingCardPos() {
  return p.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find((d) =>
      (d.className?.toString?.() || '').includes('bg-zinc-900') &&
      d.textContent.includes('Click to view details'),
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), top: Math.round(r.top), opacity: getComputedStyle(el).opacity }
  })
}

// Enter the card
await p.mouse.move(card.x, card.y)
await sleep(1400) // past HOVER_DELAY + fade

const s1 = await floatingCardPos()
console.log('mouse center      →', JSON.stringify(s1))

// Move within card toward its right edge — follower should slide right
await p.mouse.move(card.right - 20, card.y + 8)
await sleep(500)
const s2 = await floatingCardPos()
console.log('mouse right edge  →', JSON.stringify(s2))

// Move toward the left edge — follower should slide back left
await p.mouse.move(card.left + 20, card.y - 8)
await sleep(500)
const s3 = await floatingCardPos()
console.log('mouse left edge   →', JSON.stringify(s3))

const moves = s1 && s2 && s3
  ? (Math.abs(s2.left - s1.left) > 10 || Math.abs(s3.left - s2.left) > 10)
  : false
console.log('follows cursor:', moves ? 'YES ✅' : 'NO ❌')
console.log(moves ? 'FOLLOW OK' : 'FOLLOW FAILED')
await b.close()
process.exit(moves ? 0 : 1)
