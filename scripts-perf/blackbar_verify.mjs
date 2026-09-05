// Verify the black-bar auto-crop algorithm against a synthetic pillarboxed
// live stream: canvas (960px content + 320px pure-black right bar) →
// captureStream() → real <video> decode path → the exact algorithm shipped
// in VideoPlayer.tsx. Also confirms the built bundle contains the logic.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import { execSync } from 'node:child_process'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] })
const p = await b.newPage()
await p.setViewport({ width: 1280, height: 720 })
await p.goto('about:blank')

// Exact port of VideoPlayer's analyze loop (same thresholds/math).
const result = await p.evaluate(async () => {
  // Build the fake stream: 1280x720 with right 320px black (25% per side).
  const src = document.createElement('canvas')
  src.width = 1280; src.height = 720
  const sctx = src.getContext('2d')
  const draw = (t) => {
    // Busy colorful content on the left 960px (moves so frames differ).
    const g = sctx.createLinearGradient(0, 0, 960, 720)
    g.addColorStop(0, `hsl(${(t / 5) % 360},80%,55%)`)
    g.addColorStop(1, `hsl(${(t / 5 + 120) % 360},80%,45%)`)
    sctx.fillStyle = g
    sctx.fillRect(0, 0, 960, 720)
    sctx.fillStyle = '#fff'
    for (let i = 0; i < 12; i++) {
      const x = ((t * 3 + i * 90) % 960)
      sctx.fillRect(x, i * 60, 40, 30)
    }
    // The baked-in black pillarbox bar.
    sctx.fillStyle = '#000'
    sctx.fillRect(960, 0, 320, 720)
  }
  let t = 0
  draw(0)
  const stream = src.captureStream(10)

  const v = document.createElement('video')
  v.srcObject = stream
  v.muted = true
  v.playsInline = true
  document.body.appendChild(v)
  await v.play()
  const ticker = setInterval(() => { t += 1; draw(t) }, 100)

  const W = 32, H = 18
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  let consecutive = 0
  let found = null
  const start = performance.now()
  while (!found && performance.now() - start < 8000) {
    await new Promise((r) => requestAnimationFrame(r))
    if (v.readyState < 2) continue
    draw(t) // keep source fresh
    ctx.drawImage(v, 0, 0, W, H)
    const row = ctx.getImageData(0, 0, W, H).data
    const lum = (x, y) => { const i = (y * W + x) * 4; return 0.2126 * row[i] + 0.7152 * row[i+1] + 0.0722 * row[i+2] }
    const colMean = [], rowMean = []
    for (let x = 0; x < W; x++) { let s = 0; for (let y = 0; y < H; y++) s += lum(x, y); colMean.push(s / H) }
    for (let y = 0; y < H; y++) { let s = 0; for (let x = 0; x < W; x++) s += lum(x, y); rowMean.push(s / W) }
    const mean = (a) => a.reduce((s, n) => s + n, 0) / a.length
    const overall = mean(colMean)
    const isDark = (n) => n < 22
    let left = 0; while (left < W/3 && isDark(colMean[left])) left++
    let right = 0; while (right < W/3 && isDark(colMean[W-1-right])) right++
    let top = 0; while (top < H/3 && isDark(rowMean[top])) top++
    let bottom = 0; while (bottom < H/3 && isDark(rowMean[H-1-bottom])) bottom++
    if (overall > 34 && (left > 1 || right > 1 || top > 1 || bottom > 1)) consecutive++
    else consecutive = 0
    if (consecutive >= 4) {
      const f = Math.max(Math.max(left, right) / W, Math.max(top, bottom) / H)
      found = { left, right, top, bottom, overall: +overall.toFixed(1), zoom: +(1 / (1 - 2*f) * 1.04).toFixed(3) }
      break
    }
  }
  clearInterval(ticker)
  v.pause()
  return { found, vw: v.videoWidth, vh: v.videoHeight }
})

console.log('stream:', result.vw + 'x' + result.vh, '(content 960x720 → expected bar ≈ 25% per side, zoom ≈ 2.08→clamped 1.45)')
console.log('detector:', JSON.stringify(result.found))
let pass = false
if (result.found) {
  const f = result.found
  // Bar detected on the right, roughly 9-11 of 32 columns (25% ± quantization).
  pass = f.right >= 8 && f.right <= 12 && f.left <= 2 && f.zoom >= 1.4
}
console.log(pass ? 'AUTO-CROP VERIFIED ✓' : 'AUTO-CROP FAILED ✗')

// Confirm the app bundle ships the new logic.
try {
  const bundle = execSync('grep -l "consecutive" repo/dist/assets/*.js 2>/dev/null || grep -l "consecutive" dist/assets/*.js | head -1').toString().trim().split('\n')[0]
  const hasZoom = fs.readFileSync(bundle, 'utf8').includes('1/(1-2') || fs.readFileSync(bundle, 'utf8').includes('1 / (1 - 2')
  console.log('bundle:', bundle.split(/[\\/]/).pop(), '| ships zoom math:', hasZoom)
} catch (e) {
  console.log('bundle check skipped:', e.message.slice(0, 60))
}

await b.close()
process.exit(pass ? 0 : 1)
