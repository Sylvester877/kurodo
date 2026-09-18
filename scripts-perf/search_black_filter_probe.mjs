// Diagnose the "black filter" blocking search screenshots:
//  1. any full-viewport overlay elements (position:fixed, high z-index)?
//  2. poster <img> states at screenshot time (opacity, naturalWidth, complete)
//  3. what element is on top at several grid points
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

await p.goto('http://localhost:5173/search?q=naruto', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 5000))

const diag = await p.evaluate(() => {
  // 1. Fixed overlays covering most of the viewport
  const overlays = []
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed') continue
    const r = el.getBoundingClientRect()
    const covers = r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9
    if (!covers) continue
    const opaque = parseFloat(cs.background.slice(cs.background.lastIndexOf(')') + 1)) || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? 1 : 0)
    overlays.push({
      tag: el.tagName,
      cls: (el.className?.toString?.() || '').slice(0, 90),
      z: cs.zIndex,
      bg: cs.backgroundColor,
      filter: cs.filter,
      backdrop: cs.backdropFilter,
      display: cs.display,
      pointerEvents: cs.pointerEvents,
    })
  }

  // 2. Poster image states
  const imgs = [...document.querySelectorAll('.poster-frame img')].slice(0, 12).map((img) => {
    const cs = getComputedStyle(img)
    return {
      src: img.currentSrc?.slice(0, 60) || img.src.slice(0, 60),
      complete: img.complete,
      nw: img.naturalWidth,
      opacity: cs.opacity,
      visible: img.getClientRects().length > 0,
    }
  })

  // 3. What's on top at grid points
  const tops = []
  for (const [fx, fy] of [[0.3, 0.5], [0.5, 0.5], [0.7, 0.5], [0.5, 0.8]]) {
    const el = document.elementFromPoint(innerWidth * fx, innerHeight * fy)
    tops.push({
      at: `${fx},${fy}`,
      tag: el?.tagName,
      cls: (el?.className?.toString?.() || '').slice(0, 60),
    })
  }

  // 4. Root/body filters
  const bodyCs = getComputedStyle(document.body)
  const htmlCs = getComputedStyle(document.documentElement)

  return {
    overlays,
    imgCount: document.querySelectorAll('.poster-frame img').length,
    imgs,
    tops,
    bodyFilter: bodyCs.filter,
    htmlFilter: htmlCs.filter,
    bodyOpacity: bodyCs.opacity,
  }
})
console.log(JSON.stringify(diag, null, 2))

await b.close()
