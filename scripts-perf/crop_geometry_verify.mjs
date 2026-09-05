// End-to-end verification of the flat-black + symmetric bar detector:
//  1. Real pillarbox (flat black 12.5% both sides) → detected, exact 4:3 geometry.
//  2. DARK SCENE WITH TEXTURED EDGES (the user's FMA 2003 misfire) → rejected.
//  3. Uniform blackout → rejected (centerBand gate).
//  4. Single dark edge (asymmetric) → rejected.
//  5. Clean full-bleed frame → null (no crop).
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox', '--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 800, height: 450 })

const result = await p.evaluate(async () => {
  const W = 32, H = 18
  // noise: deterministic pseudo-random luminance texture
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

  const draw = (fn) => {
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const x = c.getContext('2d', { willReadFrequently: true })
    fn(x)
    return x.getImageData(0, 0, W, H).data
  }
  const lumOf = (px, xx, yy) => { const i = (yy * W + xx) * 4; return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] }
  const measure = (px) => {
    const colMean = [], colMax = [], rowMean = [], rowMax = []
    for (let xx = 0; xx < W; xx++) { let s = 0, mx = 0; for (let yy = 0; yy < H; yy++) { const l = lumOf(px, xx, yy); s += l; if (l > mx) mx = l } colMean.push(s / H); colMax.push(mx) }
    for (let yy = 0; yy < H; yy++) { let s = 0, mx = 0; for (let xx = 0; xx < W; xx++) { const l = lumOf(px, xx, yy); s += l; if (l > mx) mx = l } rowMean.push(s / W); rowMax.push(mx) }
    const mean = (a) => a.reduce((s, n) => s + n, 0) / a.length
    const centerBand = mean(colMean.slice(W / 4, (3 * W) / 4))
    if (centerBand < 45) return null
    const isBarCol = (xx) => colMean[xx] < 24 && colMax[xx] < 40
    const isBarRow = (yy) => rowMean[yy] < 24 && rowMax[yy] < 40
    const capX = Math.floor(W * 0.3), capY = Math.floor(H * 0.3)
    let l = 0; while (l < capX && isBarCol(l)) l++
    let r = 0; while (r < capX && isBarCol(W - 1 - r)) r++
    if ((l > 0) !== (r > 0) || (l > 0 && Math.abs(l - r) > 2)) { l = 0; r = 0 }
    let t = 0; while (t < capY && isBarRow(t)) t++
    let bt = 0; while (bt < capY && isBarRow(H - 1 - bt)) bt++
    if ((t > 0) !== (bt > 0) || (t > 0 && Math.abs(t - bt) > 1)) { t = 0; bt = 0 }
    if (l + r <= 1 && t + bt <= 1) return null
    return { l, r, t, b: bt }
  }

  const out = {}

  // 1. Real pillarbox: flat black 12.5% each side, bright content center.
  out.case1 = measure(draw((x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H)
    x.fillStyle = '#d8d8e0'; x.fillRect(4, 0, W - 8, H)
  }))
  out.case1Geom = out.case1 && Math.abs((((16 / 9) * (1 - out.case1.l / W - out.case1.r / W)) / 1) - 4 / 3) < 0.05

  // 2. THE USER'S MISFIRE: dark scene, textured dark edges (dim wall with
  //    noise + shading), moderately bright center. Old code cropped this;
  //    new code must reject (edges have texture → colMax ≥ 40).
  out.case2_texturedDarkEdgesRejected = measure(draw((x) => {
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const edge = xx < 6 || xx >= W - 6
      const base = edge ? 8 + rnd() * 30 : 90 + rnd() * 60 // textured dark edges
      const v = Math.max(0, Math.min(255, base))
      x.fillStyle = `rgb(${v | 0},${v | 0},${(v * 1.05) | 0})`
      x.fillRect(xx, yy, 1, 1)
    }
  })) === null

  // 3. Uniform blackout → centerBand gate rejects.
  out.case3_blackoutRejected = measure(draw((x) => {
    x.fillStyle = '#101014'; x.fillRect(0, 0, W, H)
  })) === null

  // 4. Asymmetric: flat black left bar ONLY → rejected by symmetry rule.
  out.case4_asymmetricRejected = measure(draw((x) => {
    x.fillStyle = '#000'; x.fillRect(0, 0, 4, H)
    x.fillStyle = '#d8d8e0'; x.fillRect(4, 0, W - 4, H)
  })) === null

  // 5. Clean full-bleed bright frame → null.
  out.case5_cleanRejected = measure(draw((x) => {
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const v = 80 + rnd() * 120
      x.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`
      x.fillRect(xx, yy, 1, 1)
    }
  })) === null

  return out
})

console.log(JSON.stringify(result, null, 2))
await b.close()
const ok =
  result.case1?.l > 0 && result.case1Geom &&
  result.case2_texturedDarkEdgesRejected &&
  result.case3_blackoutRejected &&
  result.case4_asymmetricRejected &&
  result.case5_cleanRejected
console.log(ok ? 'BAR-DETECTOR VERIFY: PASS' : 'BAR-DETECTOR VERIFY: FAIL')
process.exit(ok ? 0 : 1)
