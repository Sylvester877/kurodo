// Analyze the OS-level desktop screenshot (1536x960 = CSS pixel space).
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const file = path.join(ROOT, 'screenshots', 'fs-os-desktop.png')
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
  const colMax = (x) => { let mx = 0; for (let y = 0; y < H; y += 3) { const i = (y * W + x) * 4; mx = Math.max(mx, d[i], d[i+1], d[i+2]) } return mx }
  let right = -1, left = -1
  for (let x = W - 1; x >= 0; x--) { if (colMax(x) >= 8) { right = x + 1; break } }
  for (let x = 0; x < W; x++) { if (colMax(x) >= 8) { left = x; break } }
  // bottom too
  const rowMax = (y) => { let mx = 0; for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 4; mx = Math.max(mx, d[i], d[i+1], d[i+2]) } return mx }
  let bottom = -1
  for (let y = H - 1; y >= 0; y--) { if (rowMax(y) >= 8) { bottom = y + 1; break } }
  return { W, H, rightBlack: right < 0 ? W : W - right, leftBlack: left, bottomBlack: bottom < 0 ? H : H - bottom }
})()`)
await b.close()
console.log('OS GROUND TRUTH:', res.W, 'x', res.H)
console.log('  right black :', res.rightBlack, 'px (css)')
console.log('  left black  :', res.leftBlack, 'px')
console.log('  bottom black:', res.bottomBlack, 'px')
console.log(res.rightBlack <= 2 ? '✅ no right gap on the physical panel' : '❌ right gap EXISTS on panel: ' + res.rightBlack + 'px css = ' + Math.round(res.rightBlack * 1.25) + 'px physical')
