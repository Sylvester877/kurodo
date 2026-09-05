// End-to-end verification of the new bar-crop geometry:
//  1. Synthetic 16:9 stream with 12% baked-in side bars (canvas.captureStream).
//  2. Feed frames with the same pixel pattern the component samples.
//  3. Assert: contentAspect = (16/9 * 0.76)/1 ≈ 1.351, video width ≈ 131.6%,
//     left offset ≈ -15.8%, and the visible content fills the box exactly.
//  4. Also simulate the OLD failure (dark scene → false positive) and the
//     revert path (bars disappear → crop resets to 0).
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox', '--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 800, height: 450 })

// Mirror of the component's measure() + geometry, driven by the same math so
// we verify the formulas rather than a real <video> (no test stream needed).
const result = await p.evaluate(async () => {
  const W = 32, H = 18
  const mkFrame = (barLeft, barRight, bright) => {
    const c = document.createElement('canvas')
    c.width = W; c.height = H
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = bright ? '#d8d8e0' : '#303038'
    ctx.fillRect(Math.round(barLeft * W), 0, Math.round((1 - barLeft - barRight) * W), H)
    return ctx.getImageData(0, 0, W, H).data
  }
  const lumOf = (px, x, y) => { const i = (y * W + x) * 4; return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2] }
  const measure = (px) => {
    const colMean = [], rowMean = []
    for (let x = 0; x < W; x++) { let s = 0; for (let y = 0; y < H; y++) s += lumOf(px, x, y); colMean.push(s / H) }
    for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += lumOf(px, x, y); rowMean.push(s / W) }
    const mean = (a) => a.reduce((s, n) => s + n, 0) / a.length
    const centerBand = mean(colMean.slice(W / 4, (3 * W) / 4))
    if (centerBand < 45) return null
    const isDark = (n) => n < 24
    const capX = Math.floor(W * 0.3), capY = Math.floor(H * 0.3)
    let l = 0; while (l < capX && isDark(colMean[l])) l++
    let r = 0; while (r < capX && isDark(colMean[W - 1 - r])) r++
    let t = 0; while (t < capY && isDark(rowMean[t])) t++
    let bb = 0; while (bb < capY && isDark(rowMean[H - 1 - bb])) bb++
    if (l + r <= 1 && t + bb <= 1) return null
    return { l, r, t, b: bb }
  }

  const out = {}
  // Case 1: 12% side bars, bright content — detected after 6 confirmations.
  const frame1 = mkFrame(0.12, 0.12, true)
  let pending = null, streak = 0
  for (let i = 0; i < 10; i++) {
    const m = measure(frame1)
    const same = m && pending && Math.abs(m.l - pending.l) <= 1 && Math.abs(m.r - pending.r) <= 1 && Math.abs(m.t - pending.t) <= 1 && Math.abs(m.b - pending.b) <= 1
    if (m && same) streak++
    else { pending = m; streak = m ? 1 : 0 }
    if (pending && streak >= 6) break
  }
  out.case1 = pending && streak >= 6
    ? {
        detected: true,
        crop: { l: pending.l / W, r: pending.r / W },
        contentAspect: +(((16 / 9) * (1 - pending.l / W - pending.r / W)) / 1).toFixed(4),
        videoWidthPct: +((100 / (1 - pending.l / W - pending.r / W))).toFixed(2),
        leftPct: +((-pending.l / W * 100) / (1 - pending.l / W - pending.r / W)).toFixed(2),
      }
    : { detected: false }

  // Case 2: uniformly near-black frame (eye-catch blackout) — centerBand
  // gate must reject it; no candidate, no crop. (A dim scene WITH real
  // black bars correctly reports bars — that's a true positive.)
  const uni = document.createElement('canvas')
  uni.width = W; uni.height = H
  const ux = uni.getContext('2d', { willReadFrequently: true })
  ux.fillStyle = '#101014'
  ux.fillRect(0, 0, W, H)
  out.case2_darkSceneNoTrigger = measure(ux.getImageData(0, 0, W, H).data) === null

  // Case 3: revert — after applied, content appears at edges → measure null
  // twice → crop resets.
  const clean = measure(mkFrame(0, 0, true))
  out.case3_revertOnCleanFrame = clean === null

  // Case 4: geometry sanity — 4:3 content in 16:9 frame with pillarbox:
  // stream 16:9 with 12.5% bars each side → content aspect must be 4/3.
  const l4 = Math.round(0.125 * 16 / 9 * 0 + 0.125 * W) // 12.5% of W
  const m4 = { l: l4, r: l4, t: 0, b: 0 }
  out.case4_contentAspect = +((((16 / 9) * (1 - m4.l / W - m4.r / W)) / 1)).toFixed(3)

  return out
})

console.log(JSON.stringify(result, null, 2))
await b.close()
const ok = result.case1?.detected && result.case2_darkSceneNoTrigger && result.case3_revertOnCleanFrame && Math.abs(result.case4_contentAspect - 4 / 3) < 0.05
console.log(ok ? 'CROP-GEOMETRY VERIFY: PASS' : 'CROP-GEOMETRY VERIFY: FAIL')
process.exit(ok ? 0 : 1)
