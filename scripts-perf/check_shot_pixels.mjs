// Prove the screenshots contain real picture: mean luminance, std,
// brightness histogram bands via canvas.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
const p = await b.newPage()

for (const name of ['fixed-video-1-small.png', 'fixed-video-2-small.png', 'fixed-video-3-small.png']) {
  const file = path.join(ROOT, 'screenshots', name)
  if (!fs.existsSync(file)) { console.log(name, ': MISSING'); continue }
  const b64 = fs.readFileSync(file).toString('base64')
  const stats = await p.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await new Promise((r) => { img.onload = r })
    const c = document.createElement('canvas')
    const W = 200, H = Math.round((img.height / img.width) * 200)
    c.width = W; c.height = H
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0, W, H)
    const d = x.getImageData(0, 0, W, H).data
    let sum = 0, black = 0, bright = 0
    const lums = []
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      lums.push(l); sum += l
      if (l < 12) black++
      if (l > 180) bright++
    }
    const mean = sum / lums.length
    let v2 = 0
    for (const l of lums) v2 += (l - mean) * (l - mean)
    return { mean: +mean.toFixed(1), std: +Math.sqrt(v2 / lums.length).toFixed(1), blackPct: +((black / lums.length) * 100).toFixed(1), brightPct: +((bright / lums.length) * 100).toFixed(1), w: img.width, h: img.height }
  }, b64)
  console.log(name, JSON.stringify(stats))
}
await b.close()
process.exit(0)
