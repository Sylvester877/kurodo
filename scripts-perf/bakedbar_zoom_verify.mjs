// Pixel-verify the fullscreen baked-bar zoom in the real renderer.
// Synthetic 1600×900 frame, black bars baked top/bottom (110px each,
// ~2.35:1 content, bright red fill). Rendered in an 800×450 (16:9) box
// with overflow hidden + object-fit cover:
//   A) no zoom      → black bars visible (the current fullscreen bug)
//   B) scale(1/(1-t-b)) → bars pushed outside the box → no black pixels
// Each case is captured with a clipped CDP screenshot and the pixels are
// sampled back in-page (no DOM canvas drawImage restrictions).
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await b.pages()
const page = pages.find((p) => p.url().includes('localhost:5173')) || pages[0]
log('using', page.url())

// Build the synthetic frame once and store its data URL on the page
const frameUrl = await page.evaluate(() => {
  const FW = 1600, FH = 900, BAR = 110
  const c = document.createElement('canvas')
  c.width = FW; c.height = FH
  const x = c.getContext('2d')
  x.fillStyle = '#000'; x.fillRect(0, 0, FW, FH)
  x.fillStyle = '#ff2a2a'; x.fillRect(0, BAR, FW, FH - 2 * BAR)
  return c.toDataURL('image/png')
})

const boxId = 'zoomtestbox'
async function renderCase(scale) {
  await page.evaluate(({ boxId, frameUrl, scale }) => {
    document.getElementById(boxId)?.remove()
    const box = document.createElement('div')
    box.id = boxId
    box.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:450px;overflow:hidden;background:#000;z-index:99999;'
    const img = document.createElement('img')
    img.style.cssText = `width:100%;height:100%;object-fit:cover;display:block;${scale ? `transform:scale(${scale});` : ''}`
    img.src = frameUrl
    box.appendChild(img)
    document.body.appendChild(box)
  }, { boxId, frameUrl, scale })
  await new Promise((r) => setTimeout(r, 250))
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 800, height: 450 } })
  await page.evaluate((boxId) => document.getElementById(boxId)?.remove(), boxId)
  // Sample the captured PNG back in-page
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 800; c.height = 450
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3))
    const samples = {
      cornerTL: px(2, 2), cornerTR: px(797, 2), cornerBL: px(2, 447), cornerBR: px(797, 447),
      midTop: px(400, 2), midBottom: px(400, 447), midLeft: px(2, 225), midRight: px(797, 225),
      center: px(400, 225),
    }
    const isBlack = (p) => p[0] < 10 && p[1] < 10 && p[2] < 10
    const blackPts = Object.entries(samples).filter(([, p]) => isBlack(p)).map(([k]) => k)
    return { blackPts, samples }
  }, shot.toString('base64'))
}

const tB = 110 / 900
const zoom = 1 / (1 - 2 * tB)
log('bar fraction t/b =', tB.toFixed(4), ' zoom =', zoom.toFixed(4))

const without = await renderCase(null)
log('CASE A (no zoom, the bug)   black points:', JSON.stringify(without.blackPts), ' center:', JSON.stringify(without.samples.center))
const withZoom = await renderCase(zoom.toFixed(4))
log('CASE B (zoom applied)       black points:', JSON.stringify(withZoom.blackPts), ' center:', JSON.stringify(withZoom.samples.center))

const bug = without.blackPts.includes('cornerTL') && without.blackPts.includes('cornerTR')
const fixed = withZoom.blackPts.length === 0
console.log(bug ? '❌ CONFIRMED BUG: corners black without zoom' : '⚠️ corners not black without zoom?')
console.log(fixed ? '✅ ZOOM REMOVES ALL BAKED BARS — gap gone' : '❌ zoom did NOT fully remove bars')
await b.disconnect()
process.exit(0)
