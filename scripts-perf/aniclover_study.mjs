// Study aniclover.cc's hover card: positioning strategy (follows mouse?
// anchored to card? centered above?), animation style, and DOM structure.
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

// Find an anime card and hover it
const card = await p.evaluate(() => {
  // look for poster-ish links/images in the trending grid
  const imgs = [...document.querySelectorAll('a img, [class*="card"] img, [class*="poster"] img')]
  const el = imgs.find((i) => {
    const r = i.getBoundingClientRect()
    return r.width > 100 && r.top > 80 && r.bottom < innerHeight * 0.9
  })
  if (!el) return null
  // hover the anchor ancestor
  const a = el.closest('a') || el
  const r = a.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }
})
if (!card) { console.log('no card found'); await b.close(); process.exit(1) }
console.log('hovering card at', JSON.stringify(card))

await p.mouse.move(card.x, card.y)
await sleep(300)
await p.mouse.move(card.x + 2, card.y + 2)
await sleep(2000)

// Capture the hover card's behavior: track position over multiple mouse moves
const samples = []
for (const dx of [0, 20, -20, 40]) {
  await p.mouse.move(card.x + dx, card.y + 5)
  await sleep(450)
  const pos = await p.evaluate(() => {
    // find a floating/portal-ish element: fixed/absolute positioned, large, contains title text
    let best = null
    for (const el of document.querySelectorAll('div, section')) {
      const cs = getComputedStyle(el)
      if (!['fixed', 'absolute'].includes(cs.position)) continue
      const r = el.getBoundingClientRect()
      if (r.width < 240 || r.width > 500 || r.height < 200) continue
      const text = el.textContent || ''
      if (!/\d\.\d/.test(text) || text.length < 80) continue
      // heuristics: it overlays the grid and has genre-like words
      if (/(Action|Adventure|Drama|Comedy|Fantasy|Sci)/.test(text)) {
        if (!best || r.width * r.height < best.area) {
          best = { area: r.width * r.height, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
        }
      }
    }
    return best
  })
  samples.push({ mouseDx: dx, card: pos })
  console.log('mouse dx', dx, '→ card', JSON.stringify(pos))
}

// Also capture transition/animation styles of that floating card
const anim = await p.evaluate(() => {
  for (const el of document.querySelectorAll('div, section')) {
    const cs = getComputedStyle(el)
    if (!['fixed', 'absolute'].includes(cs.position)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 240 || r.width > 500 || r.height < 200) continue
    const text = el.textContent || ''
    if (!/(Action|Adventure|Drama|Comedy)/.test(text)) continue
    return {
      transition: cs.transition.slice(0, 120),
      transform: cs.transform.slice(0, 60),
      animationName: cs.animationName,
      boxShadow: cs.boxShadow.slice(0, 80),
      zIndex: cs.zIndex,
      className: (el.className?.toString?.() || '').slice(0, 100),
      tag: el.tagName,
    }
  }
  return null
})
console.log('anim:', JSON.stringify(anim, null, 1))
console.log('SAMPLES:', JSON.stringify(samples))

await p.screenshot({ path: 'screenshots/aniclover-reference.png' })
await b.close()
