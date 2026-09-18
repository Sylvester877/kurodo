// Second pass: hover over the player to mount controls; also search shadow roots.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await p.goto('https://anikage.cc/anime/watch/3FMkbr7zt8', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(14000)

// hover center-bottom of the video to summon controls
const v = await p.evaluate(() => { const el = document.querySelector('video'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height - 40) } })
await p.mouse.move(v.x, v.y)
await sleep(2500)

const out = await p.evaluate(() => {
  const txt = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)
  const video = document.querySelector('video')
  const vb = video ? video.getBoundingClientRect() : null
  const y0 = vb ? vb.bottom : 0
  // all elements with role=button/button/slider whose top is within [vb.top-10, window height] and that sit near player
  const cands = [...document.querySelectorAll('button, [role="button"], [role="slider"], input[type="range"], [class*="seek"], [class*="progress"], [class*="control"], [class*="player"]')]
    .filter((el) => el.offsetParent && vb && el.getBoundingClientRect().top >= vb.top - 40)
    .map((el) => {
      const r = el.getBoundingClientRect()
      const cls = (el.className + '').toString().slice(0, 120)
      return {
        tag: el.tagName.toLowerCase(),
        cls,
        txt: txt(el).slice(0, 26),
        aria: (el.getAttribute('aria-label') || '').slice(0, 40),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      }
    })
    .filter((c) => c.rect.h > 0 && c.rect.w > 0)

  // shadow root scan (any host with shadowRoot)
  const shadows = []
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        shadows.push({ host: (el.className + '').toString().slice(0, 60), tag: el.tagName })
        walk(el.shadowRoot)
      }
    }
  }
  walk(document)
  return { cands: cands.slice(0, 60), shadows: shadows.slice(0, 10), videoBottom: Math.round(y0) }
})
console.log('candidates:', out.cands.length)
for (const c of out.cands) console.log(' ', JSON.stringify(c))
console.log('shadow hosts:', JSON.stringify(out.shadows))
await p.screenshot({ path: 'screenshots/anikage-player-hover.png' })
await b.close()
