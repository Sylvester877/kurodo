// Track aniclover's .anime-card-qtip: does it follow the cursor or anchor to the card?
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
await p.setViewport({ width: 1600, height: 900 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await p.goto('https://aniclover.cc/', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(6000)

// Find two distinct cards far apart
const cards = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll('a img, [class*="card"] img, [class*="poster"] img')]
  const els = imgs
    .map((i) => (i.closest('a') || i))
    .filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 100 && r.top > 80 && r.bottom < innerHeight * 0.9
    })
  return els.slice(0, 6).map((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
})
console.log('cards:', JSON.stringify(cards))
if (cards.length < 2) { await b.close(); process.exit(1) }

async function qtipState() {
  return p.evaluate(() => {
    const q = document.querySelector('.anime-card-qtip') ||
      [...document.querySelectorAll('div')].find((d) => d.className?.toString?.().includes('qtip'))
    if (!q) return null
    const cs = getComputedStyle(q)
    const r = q.getBoundingClientRect()
    return {
      left: Math.round(r.left), top: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      styleLeft: q.style.left || '(none)',
      styleTop: q.style.top || '(none)',
      transform: cs.transform === 'none' ? 'none' : cs.transform.slice(0, 60),
      opacity: cs.opacity,
    }
  })
}

// Hover card 1, then move within it, then jump to card 2
const [c1, c2] = cards
await p.mouse.move(c1.x, c1.y)
await sleep(250)
await p.mouse.move(c1.x + 2, c1.y + 2)
await sleep(1800)
console.log('on card1        :', JSON.stringify(await qtipState()))

await p.mouse.move(c1.x + 30, c1.y - 10)
await sleep(500)
console.log('card1 +30,-10   :', JSON.stringify(await qtipState()))

await p.mouse.move(c1.x - 25, c1.y + 15)
await sleep(500)
console.log('card1 -25,+15   :', JSON.stringify(await qtipState()))

await p.mouse.move(c2.x, c2.y)
await sleep(1500)
console.log('on card2        :', JSON.stringify(await qtipState()))

// Sample rapidly right after entering card2 to see if it glides (spring) or snaps
const glide = []
for (let i = 0; i < 6; i++) {
  glide.push(await qtipState())
  await sleep(90)
}
console.log('glide samples  :', JSON.stringify(glide.map((g) => g && `${g.left},${g.top}`)))

await p.screenshot({ path: 'screenshots/aniclover-reference.png' })
await b.close()
