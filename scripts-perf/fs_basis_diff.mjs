// Column-level diff between fullscreen (A) and windowed (B) native shots —
// columns that differ = where the app actually draws. This finds the real
// fullscreen picture bounds regardless of capture-scaling weirdness.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setContent(`
<img id=a src="data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'screenshots', 'fs-basis-a.png')).toString('base64')}">
<img id=c src="data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'screenshots', 'fs-basis-c.png')).toString('base64')}">
<img id=w src="data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'screenshots', 'fs-basis-b.png')).toString('base64')}">
`)
await p.waitForSelector('#c')
const res = await p.evaluate(`(async () => {
  const [a, c, w] = await Promise.all([document.getElementById('a'), document.getElementById('c'), document.getElementById('w')].map(i => i.decode().then(() => i)))
  const W = a.naturalWidth, H = a.naturalHeight
  const grab = (img) => {
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return ctx.getImageData(0, 0, W, H).data
  }
  const da = grab(a), dc = grab(c), dw = grab(w)
  // fullscreen columns = where BOTH fullscreen shots have non-black content
  // OR where they differ from the windowed shot
  // Report: for each sampled column, is fs-nonblack and is it different from windowed
  const out = []
  for (let x = 0; x < W; x += 32) {
    let fsNonBlack = 0, diffFromWin = 0, n = 0
    for (let y = 100; y < H - 100; y += 12) {
      const ia = (y * W + x) * 4
      const ma = Math.max(da[ia], da[ia+1], da[ia+2])
      const mc = Math.max(dc[ia], dc[ia+1], dc[ia+2])
      const mw = Math.max(dw[ia], dw[ia+1], dw[ia+2])
      if (ma >= 24 || mc >= 24) fsNonBlack++
      if (Math.abs(ma - mw) > 20 || Math.abs(mc - mw) > 20) diffFromWin++
      n++
    }
    out.push({ x, fsPct: Math.round(fsNonBlack / n * 100), diffPct: Math.round(diffFromWin / n * 100) })
  }
  return { W, cols: out }
})()`)
await b.close()
console.log('x | fs-content% | differs-from-windowed%')
res.cols.forEach((c) => console.log(String(c.x).padStart(5), String(c.fsPct).padStart(5), String(c.diffPct).padStart(8)))
// find last x with significant fs content
const withContent = res.cols.filter((c) => c.fsPct > 15)
console.log('\nlast fullscreen-content column:', withContent.length ? withContent[withContent.length - 1].x : 'none', 'of', res.W)
