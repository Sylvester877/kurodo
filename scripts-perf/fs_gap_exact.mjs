// Exact black-band bounds on the right edge of the fullscreen screenshot.
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
  // exact first-black-column-from-right: all sampled rows pure black (max<8)
  const colMax = (x) => { let mx = 0; for (let y = 0; y < H; y += 3) { const i = (y * W + x) * 4; mx = Math.max(mx, d[i], d[i+1], d[i+2]) } return mx }
  let firstBlackFromRight = -1
  for (let x = W - 1; x >= 0; x--) { if (colMax(x) >= 8) { firstBlackFromRight = x + 1; break } }
  let firstBlackFromLeft = -1
  for (let x = 0; x < W; x++) { if (colMax(x) >= 8) { firstBlackFromLeft = x; break } }
  // also probe bottom edge (rows) for completeness
  const rowMax = (y) => { let mx = 0; for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 4; mx = Math.max(mx, d[i], d[i+1], d[i+2]) } return mx }
  let firstBlackRowFromBottom = -1
  for (let y = H - 1; y >= 0; y--) { if (rowMax(y) >= 8) { firstBlackRowFromBottom = y + 1; break } }
  return { W, H, rightBlackPx: firstBlackFromRight < 0 ? W : W - firstBlackFromRight, leftBlackPx: firstBlackFromLeft, bottomBlackPx: firstBlackRowFromBottom < 0 ? H : H - firstBlackRowFromBottom }
})()`)
await b.close()
console.log('frame:', res.W, 'x', res.H)
console.log('black band RIGHT :', res.rightBlackPx, 'px')
console.log('black band LEFT  :', res.leftBlackPx, 'px')
console.log('black band BOTTOM:', res.bottomBlackPx, 'px')
const verdict = res.rightBlackPx === 0 ? '✅ NO right gap' : res.rightBlackPx <= 2 ? '✅ negligible (≤2px)' : '❌ right gap = ' + res.rightBlackPx + 'px'
console.log(verdict)
