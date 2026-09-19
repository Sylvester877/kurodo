// The 10px band forensics: is it identical pure black everywhere (padding)
// or does it contain faint structure (a real frame-edge artifact)?
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
  // per-column in the last 20: mean and max over ALL rows (fine step)
  const out = []
  for (let x = W - 20; x < W; x++) {
    let s = 0, n = 0, mx = 0
    for (let y = 0; y < H; y++) { const i = (y * W + x) * 4; const v = Math.max(d[i], d[i+1], d[i+2]); s += v; n++; mx = Math.max(mx, v) }
    out.push({ x, mean: Math.round(s / n), max: mx })
  }
  // column x=1908 values near top/mid/bottom for reference
  const ref = [100, 600, 1100].map(y => { const i = (y * W + 1908) * 4; return [d[i], d[i+1], d[i+2]] })
  return { band: out, ref1908: ref }
})()`)
await b.close()
console.log('columns W-20 .. W-1 (mean/max over all 1200 rows):')
res.band.forEach(c => console.log(`  x${c.x}  mean ${String(c.mean).padStart(3)}  max ${String(c.max).padStart(3)}`))
console.log('x1908 sample RGBs:', JSON.stringify(res.ref1908))
