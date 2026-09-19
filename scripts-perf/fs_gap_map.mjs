// Map black columns across the full frame width to find the real gap bounds.
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
  // column is black if >= 92% of sampled rows are near-black
  const colBlack = []
  for (let x = 0; x < W; x++) {
    let black = 0, n = 0
    for (let y = 0; y < H; y += 6) { const i = (y * W + x) * 4; n++; if (d[i] < 10 && d[i+1] < 10 && d[i+2] < 10) black++ }
    colBlack.push(black / n >= 0.92)
  }
  // find picture bounds
  let firstPic = -1, lastPic = -1
  for (let x = 0; x < W; x++) if (!colBlack[x]) { if (firstPic < 0) firstPic = x; lastPic = x }
  let blackCount = 0
  for (let x = 0; x < W; x++) if (colBlack[x]) blackCount++
  return { W, H, firstPic, lastPic, blackCount, leftBlack: firstPic, rightBlack: W - 1 - lastPic }
})()`)
await b.close()
console.log('frame:', res.W, 'x', res.H)
console.log('picture spans x =', res.firstPic, '..', res.lastPic)
console.log('black columns: total', res.blackCount, '| left side:', res.leftBlack, '| right side:', res.rightBlack)
console.log(res.rightBlack === 0 && res.leftBlack === 0 ? '✅ full-bleed' : res.leftBlack === res.rightBlack ? '✅ symmetric bars' : '❌ ASYMMETRIC gap')
