// Pixel-diff loop-before-*.png vs loop-after-final-*.png in Chrome/canvas.
// Reports per page: % pixels changed, bounding box of biggest changed region.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHOTS = path.join(ROOT, 'screenshots')
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const PAGES = ['home', 'browse', 'watch-reze', 'schedule', 'seasonal', 'login']

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox'],
})
const p = await b.newPage()
await p.setViewport({ width: 800, height: 600 })

for (const name of PAGES) {
  const beforePath = path.join(SHOTS, `loop-before-${name}.png`)
  const afterPath = path.join(SHOTS, `loop-after-final-${name}.png`)
  if (!fs.existsSync(beforePath) || !fs.existsSync(afterPath)) {
    console.log(`${name}: MISSING FILES`)
    continue
  }
  const b64a = fs.readFileSync(beforePath).toString('base64')
  const b64b = fs.readFileSync(afterPath).toString('base64')
  const res = await p.evaluate(
    async (a64, b64) => {
      const load = (s) =>
        new Promise((res) => {
          const img = new Image()
          img.onload = () => res(img)
          img.src = 'data:image/png;base64,' + s
        })
      const A = await load(a64)
      const B = await load(b64)
      const W = Math.min(A.width, B.width)
      const H = Math.min(A.height, B.height)
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(A, 0, 0, W, H)
      const da = ctx.getImageData(0, 0, W, H).data
      ctx.clearRect(0, 0, W, H)
      ctx.drawImage(B, 0, 0, W, H)
      const db = ctx.getImageData(0, 0, W, H).data
      let changed = 0
      let minX = W, minY = H, maxX = 0, maxY = 0
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const i = (y * W + x) * 4
          const d =
            Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])
          if (d > 45) {
            changed++
            if (x < minX) minX = x
            if (y < minY) minY = y
            if (x > maxX) maxX = x
            if (y > maxY) maxY = y
          }
        }
      }
      const total = Math.ceil(W / 2) * Math.ceil(H / 2)
      const pct = ((changed / total) * 100).toFixed(2)
      const box = changed ? `[${minX},${minY} → ${maxX},${maxY}] of ${W}x${H}` : 'n/a'
      return { pct, box, changed }
    },
    b64a,
    b64b,
  )
  console.log(`${name}: ${res.pct}% pixels changed (sampled), region ${res.box}`)
}
await b.close()
