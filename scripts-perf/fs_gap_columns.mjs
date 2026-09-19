// Column forensics on the fullscreen screenshot: mean/std RGB per column
// at both edges and center, over many rows.
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
  const probe = [0, 2, 5, 8, 11, 480, 960, 1440, 1908, 1911, 1914, 1917, 1919]
  const out = {}
  for (const x of probe) {
    let s0 = 0, s1 = 0, s2 = 0, n = 0, mx = 0
    for (let y = 0; y < H; y += 4) {
      const i = (y * W + x) * 4
      s0 += d[i]; s1 += d[i+1]; s2 += d[i+2]; n++
      mx = Math.max(mx, d[i], d[i+1], d[i+2])
    }
    out['x' + x] = { mean: [Math.round(s0/n), Math.round(s1/n), Math.round(s2/n)], max: mx }
  }
  return { W, H, cols: out }
})()`)
await b.close()
console.log('frame:', res.W, 'x', res.H)
for (const [k, v] of Object.entries(res.cols)) {
  const fromRight = res.W - 1 - parseInt(k.slice(1))
  const label = fromRight === 0 ? 'rightmost' : fromRight < 30 ? fromRight + 'px from R' : (parseInt(k.slice(1)) === 960 ? 'center' : (parseInt(k.slice(1)) < 30 ? parseInt(k.slice(1)) + 'px from L' : ''))
  console.log(`  ${k.padEnd(6)} ${label.padEnd(14)} mean RGB [${v.mean.join(',')}]  max ${v.max}`)
}
