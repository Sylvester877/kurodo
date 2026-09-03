// Dump aniclover's card + qtip DOM/CSS to understand the anchoring.
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

const card = await p.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')]
  const el = imgs.find((i) => {
    const r = i.getBoundingClientRect()
    return r.width > 90 && r.height > 120 && r.top > 60 && r.bottom < innerHeight * 0.92
  })
  if (!el) return null
  const a = el.closest('a, div, li') || el
  const r = a.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
if (!card) { console.log('no card found this run'); await b.close(); process.exit(1) }
await p.mouse.move(card.x, card.y)
await sleep(300)
await p.mouse.move(card.x + 2, card.y + 2)
await sleep(2000)

const info = await p.evaluate(() => {
  // find all elements with 'qtip' or 'tooltip' in class
  const qtips = [...document.querySelectorAll('*')]
    .filter((e) => /qtip|tooltip|hover/i.test(e.className?.toString?.() || ''))
    .slice(0, 10)
    .map((e) => {
      const cs = getComputedStyle(e)
      const r = e.getBoundingClientRect()
      return {
        cls: (e.className?.toString?.() || '').slice(0, 80),
        pos: cs.position,
        rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        opacity: cs.opacity,
        visibility: cs.visibility,
        display: cs.display,
      }
    })

  // the card being hovered — its ancestors' classes
  const hovered = document.querySelector(':hover')
  const chain = []
  let cur = hovered
  while (cur && chain.length < 8) {
    chain.push(`${cur.tagName}.${(cur.className?.toString?.() || '').slice(0, 60)}`)
    cur = cur.parentElement
  }

  // find style rules mentioning qtip
  const rules = []
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && /qtip/i.test(rule.selectorText)) {
          rules.push(rule.cssText.slice(0, 300))
        }
      }
    } catch { /* cross-origin */ }
  }

  return { qtips, hoverChain: chain, qtipRules: rules.slice(0, 12) }
})
console.log(JSON.stringify(info, null, 1))
await b.close()
