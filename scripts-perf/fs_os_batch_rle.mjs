// Right-edge RLE for all 5 stable OS screenshots.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })

const analyze = async (file) => {
  const b64 = fs.readFileSync(file).toString('base64')
  const p = await browser.newPage()
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
    // right black run per row (sample rows), threshold <24
    const rightRun = (y) => { let n = 0; for (let x = W - 1; x >= 0; x--) { const i = (y * W + x) * 4; if (Math.max(d[i], d[i+1], d[i+2]) >= 24) return n; n++ } return n }
    const rows = [200, 400, 480, 600, 800]
    const runs = rows.map((y) => rightRun(y))
    // left too
    const leftRun = (y) => { let n = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.max(d[i], d[i+1], d[i+2]) >= 24) return n; n++ } return n }
    const lruns = rows.map((y) => leftRun(y))
    return { W, H, right: runs, left: lruns }
  })()`)
  await p.close()
  return res
}

for (let i = 1; i <= 5; i++) {
  const f = path.join(ROOT, 'screenshots', `fs-os-t${i}.png`)
  const r = await analyze(f)
  console.log(`t${i}: right-black per rows [${r.right.join(', ')}]  left-black [${r.left.join(', ')}]`)
}
await browser.close()
