// Verify the cropdetect-style detector against the REAL failure modes:
//  Fixtures drawn at 320x180 (like the 1/4-res live sampling), smoothing off.
//  1. Real pillarbox (flat black, sharp boundary) → detected, exact 4:3 box.
//  2. Held fade (t=1410 ground truth shape: 0.04,0.38,0.58,0.63 ramp) → rejected.
//  3. Textured dark edges (FMA walls) → rejected (bright pixels > 2%).
//  4. Asymmetric single bar → rejected.
//  5. Blackout → rejected (center gate).
//  6. Clean frame → null.
//  7. STATE MACHINE: a fade whose boundary drifts ±1 col per sample must
//     NEVER reach the 24-sample confirm streak; static bars must reach it.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox', '--disable-gpu'] })
const p = await b.newPage()

const result = await p.evaluate(() => {
  const SW = 320, SH = 180
  let seed = 7
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

  const frame = (colBright) => {
    // colBright: per-column probability a pixel is lit (0..1); rows uniform.
    const c = document.createElement('canvas')
    c.width = SW; c.height = SH
    const x = c.getContext('2d', { willReadFrequently: true })
    const img = x.createImageData(SW, SH)
    for (let col = 0; col < SW; col++) {
      for (let y = 0; y < SH; y++) {
        const lit = rnd() < colBright[col]
        const v = lit ? 90 + rnd() * 140 : 4 + rnd() * 8
        const i = (y * SW + col) * 4
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255
      }
    }
    x.putImageData(img, 0, 0)
    return x.getImageData(0, 0, SW, SH)
  }

  // Mirror of the component's measure().
  const measure = (img) => {
    const px = img.data
    const lum = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
    const colFrac = [], colLumSum = new Array(SW).fill(0), rowFrac = []
    for (let x = 0; x < SW; x++) {
      let n = 0
      for (let y = 0; y < SH; y++) { const i = (y * SW + x) * 4; colLumSum[x] += lum(i); if (lum(i) > 26) n++ }
      colFrac.push(n / SH)
    }
    for (let y = 0; y < SH; y++) {
      let n = 0
      for (let x = 0; x < SW; x++) if (lum((y * SW + x) * 4) > 26) n++
      rowFrac.push(n / SW)
    }
    let cSum = 0
    for (let x = Math.floor(SW / 4); x < (3 * SW) / 4; x++) cSum += colLumSum[x] / SH
    if (cSum / (SW / 2) < 45) return null
    const isBarCol = (x) => colFrac[x] < 0.02
    const isBarRow = (y) => rowFrac[y] < 0.02
    const capX = Math.floor(SW * 0.25), capY = Math.floor(SH * 0.25)
    const minBarX = Math.max(2, Math.round(SW * 0.03))
    const minBarY = Math.max(2, Math.round(SH * 0.03))
    let l = 0; while (l < capX && isBarCol(l)) l++
    let r = 0; while (r < capX && isBarCol(SW - 1 - r)) r++
    if ((l > 0) !== (r > 0) || (l > 0 && Math.abs(l - r) > 1)) { l = 0; r = 0 }
    if (l > 0 && (l < minBarX || r < minBarX)) { l = 0; r = 0 }
    if (l > 0 && colFrac[l] < 0.3) { l = 0; r = 0 }
    let t = 0; while (t < capY && isBarRow(t)) t++
    let bt = 0; while (bt < capY && isBarRow(SH - 1 - bt)) bt++
    if ((t > 0) !== (bt > 0) || (t > 0 && Math.abs(t - bt) > 1)) { t = 0; bt = 0 }
    if (t > 0 && (t < minBarY || bt < minBarY)) { t = 0; bt = 0 }
    if (t > 0 && rowFrac[t] < 0.3) { t = 0; bt = 0 }
    if (l + r <= 0 && t + bt <= 0) return null
    return { l, r, t, b: bt }
  }

  const cols = (fn) => Array.from({ length: SW }, (_, i) => fn(i))
  const rowsFull = 0.85
  const out = {}

  // 1. Real pillarbox: 40 cols (12.5%) dead black each side, sharp boundary.
  const m1 = measure(frame(cols((i) => (i < 40 || i >= SW - 40 ? 0 : rowsFull))))
  out.case1 = m1
  out.case1Geom = m1 && Math.abs(((16 / 9) * (1 - m1.l / SW - m1.r / SW)) - 4 / 3) < 0.05

  // 2. Ground-truth fade shape (t=1410): 0.04, 0.38, 0.58, 0.63… ramp.
  const fadeProfile = [0.04, 0.38, 0.58, 0.63, 0.65, 0.7]
  const m2 = measure(frame(cols((i) => {
    if (i < 6) return fadeProfile[i]
    if (i >= SW - 6) return fadeProfile[SW - 1 - i]
    return rowsFull
  })))
  out.case2_fadeRejected = m2 === null

  // 3. Textured dark edges (FMA walls): 8% lit pixels at edges.
  const m3 = measure(frame(cols((i) => (i < 40 || i >= SW - 40 ? 0.08 : rowsFull))))
  out.case3_texturedRejected = m3 === null

  // 4. Asymmetric single bar.
  const m4 = measure(frame(cols((i) => (i < 40 ? 0 : rowsFull))))
  out.case4_asymmetricRejected = m4 === null

  // 5. Blackout.
  const m5 = measure(frame(cols(() => 0.01)))
  out.case5_blackoutRejected = m5 === null

  // 6. Clean frame.
  const m6 = measure(frame(cols(() => rowsFull)))
  out.case6_cleanNull = m6 === null

  // 7. State machine: fade boundary drifts 1 col/sample — streak must
  //    never hit 24; static bars must hit it.
  const CONFIRM = 24
  const runStreaks = (drift) => {
    let pending = null, streak = 0, maxStreak = 0
    for (let s = 0; s < 60; s++) {
      const barW = 40 + Math.round(drift * Math.sin(s / 4)) // oscillates
      const m = measure(frame(cols((i) => (i < barW || i >= SW - barW ? (drift === 0 ? 0 : 0.005 + 0.001 * (s % 2)) : rowsFull))))
      const same = m && pending && Math.abs(m.l - pending.l) <= 1 && Math.abs(m.r - pending.r) <= 1
      if (m && same) streak++
      else { pending = m; streak = m ? 1 : 0 }
      maxStreak = Math.max(maxStreak, streak)
    }
    return maxStreak
  }
  out.case7_fadeDriftMaxStreak = runStreaks(3) // boundary sweeps ±3 cols
  out.case7_staticBarsMaxStreak = runStreaks(0)

  return out
})

console.log(JSON.stringify(result, null, 2))
await b.close()
const ok =
  result.case1?.l > 0 && result.case1Geom &&
  result.case2_fadeRejected && result.case3_texturedRejected &&
  result.case4_asymmetricRejected && result.case5_blackoutRejected &&
  result.case6_cleanNull &&
  result.case7_fadeDriftMaxStreak < 24 && result.case7_staticBarsMaxStreak >= 24
console.log(ok ? 'CROPDETECT VERIFY: PASS' : 'CROPDETECT VERIFY: FAIL')
process.exit(ok ? 0 : 1)
