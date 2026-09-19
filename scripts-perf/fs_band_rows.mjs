// Is the 10px right band uniform down every row (compositor margin) or
// does its width vary by row (video frame content)?
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const file = path.join(ROOT, 'screenshots', 'fs-gap-fullscreen.png')
const b64 = fs.readFileSync(file).toString('base64')

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setContent(`<img id=i src="data:image/png;base64,${b64}">`)
await p.waitForSelector('#i')
const res = await p.evaluate(`(async () => {
  const img = document.getElementById('i')
  await img.decode()
  const W = img.naturalWidth, H = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, W, H).data
  // For a sample of rows, find the first non-black pixel from the right
  const rows = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1199]
  const perRow = rows.map((y) => {
    let firstNonBlack = -1
    for (let x = W - 1; x >= W - 60; x--) {
      const i = (y * W + x) * 4
      if (Math.max(d[i], d[i+1], d[i+2]) >= 8) { firstNonBlack = W - 1 - x; break }
    }
    return { y, blackFromRight: firstNonBlack < 0 ? 60 : firstNonBlack }
  })
  // Also sample actual RGB inside the band at a few rows
  const bandRGB = rows.slice(0, 6).map((y) => {
    const i = (y * W + (W - 5)) * 4
    return [d[i], d[i+1], d[i+2]]
  })
  return { W, H, perRow, bandRGB }
})()`)
await b.close()
console.log('frame:', res.W, 'x', res.H)
console.log('black-run from right per row:')
res.perRow.forEach((r) => console.log(`  y=${String(r.y).padStart(4)}  black px: ${r.blackFromRight}`))
console.log('band RGB samples (x=W-5):', JSON.stringify(res.bandRGB))
const widths = res.perRow.map((r) => r.blackFromRight)
const uniform = widths.every((w2) => w2 === widths[0])
console.log(uniform ? '\n→ UNIFORM band = compositor-level margin' : '\n→ VARYING band = video picture content')
