// Compress README gallery screenshots: PNG → quality-82 JPEG, max 1600px wide.
// Writes to docs/ so the README loads fast (heavy multi-MB PNGs make the repo
// page sluggish and blow past GitHub's raw-asset limits).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SRC = path.join(ROOT, 'screenshots')
const OUT = path.join(ROOT, 'docs')
fs.mkdirSync(OUT, { recursive: true })

const SHOTS = [
  'ui-home-after',
  'watch-jujutsu-kaisen',
  'watch-one-piece',
  'watch-reze-movie',
  'loop-after-schedule',
  'ui-browse-after',
  'search-redesign-results',
  'search-redesign-filtered',
  'review-seasonal-stepper',
  'review-watch-picker',
]

// Decode via Chrome canvas (no native deps), downscale to ≤1600w, encode JPEG q82.
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const puppeteer = (await import('puppeteer')).default
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()

for (const name of SHOTS) {
  const src = path.join(SRC, `${name}.png`)
  if (!fs.existsSync(src)) { console.log('skip (missing):', name); continue }
  const b64 = fs.readFileSync(src).toString('base64')
  const outB64 = await p.evaluate(async (b64) => {
    const resp = await fetch(`data:image/png;base64,${b64}`)
    const bmp = await createImageBitmap(await resp.blob())
    const maxW = 1600
    const scale = Math.min(1, maxW / bmp.width)
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    const ctx = c.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.82).split(',')[1]
  }, b64)
  const dest = path.join(OUT, `${name}.jpg`)
  fs.writeFileSync(dest, Buffer.from(outB64, 'base64'))
  const kb = (fs.statSync(dest).size / 1024).toFixed(0)
  console.log(`${name}.jpg  ${kb} KB`)
}

await b.close()
console.log('DONE')
