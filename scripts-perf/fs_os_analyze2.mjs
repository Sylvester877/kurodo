// What's in the OS shot? Quadrant + edge-strip analysis.
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
  const at = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i+1], d[i+2]] }
  // mean of a box
  const box = (x0, y0, x1, y1) => {
    let s = [0, 0, 0], n = 0
    for (let y = y0; y < y1; y += 3) for (let x = x0; x < x1; x += 3) { const i = (y * W + x) * 4; s[0] += d[i]; s[1] += d[i+1]; s[2] += d[i+2]; n++ }
    return [Math.round(s[0]/n), Math.round(s[1]/n), Math.round(s[2]/n)]
  }
  return {
    W, H,
    center: box(Math.floor(W*0.4), Math.floor(H*0.4), Math.floor(W*0.6), Math.floor(H*0.6)),
    rightStrip: box(W - 250, Math.floor(H*0.3), W - 10, Math.floor(H*0.7)),
    leftStrip: box(10, Math.floor(H*0.3), 250, Math.floor(H*0.7)),
    topStrip: box(Math.floor(W*0.3), 10, Math.floor(W*0.7), 100),
    bottomStrip: box(Math.floor(W*0.3), H - 120, Math.floor(W*0.7), H - 10),
    taskbar: box(Math.floor(W*0.3), H - 50, Math.floor(W*0.7), H - 5),
    cornerTR: at(W - 3, 3),
    cornerTL: at(3, 3),
  }
})()`)
await b.close()
console.log('OS shot', res.W, 'x', res.H)
console.log('center      :', res.center)
console.log('right strip :', res.rightStrip)
console.log('left strip  :', res.leftStrip)
console.log('top strip   :', res.topStrip)
console.log('bottom strip:', res.bottomStrip)
console.log('taskbar zone:', res.taskbar)
console.log('corner TR   :', res.cornerTR, '| TL:', res.cornerTL)
