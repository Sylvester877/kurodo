// Pixel-level aesthetic check for the /login screenshots.
// Decodes each PNG in Chrome via canvas and reports:
//   • mean luminance (should be near-black for the gate look)
//   • share of near-black pixels
//   • presence of a bright white region (the CTA button)
//   • color purity: max RGB spread (should be ~0 → truly monochrome)
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DIR = path.join(ROOT, 'screenshots')

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
try {
  const page = await browser.newPage()
  await page.goto('about:blank')

  const files = fs.readdirSync(DIR).filter((f) => f.startsWith('login-') && f.endsWith('.png'))
  for (const f of files) {
    const b64 = fs.readFileSync(path.join(DIR, f)).toString('base64')
    const stats = await page.evaluate(async (data) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      const c = document.createElement('canvas')
      // downscale for speed — stats don't need full res
      const W = 240
      const H = Math.round((img.height / img.width) * W)
      c.width = W
      c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, W, H)
      const d = ctx.getImageData(0, 0, W, H).data
      let sum = 0
      let dark = 0
      let bright = 0
      let maxSpread = 0
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i],
          g = d[i + 1],
          b = d[i + 2]
        const lum = (r + g + b) / 3
        sum += lum
        if (lum < 26) dark++
        if (lum > 235) bright++
        const spread = Math.max(r, g, b) - Math.min(r, g, b)
        if (spread > maxSpread) maxSpread = spread
      }
      const n = d.length / 4
      return {
        meanLum: +(sum / n).toFixed(1),
        darkShare: +((dark / n) * 100).toFixed(1),
        brightShare: +((bright / n) * 100).toFixed(2),
        maxSpread,
      }
    }, b64)
    const verdict =
      stats.meanLum < 60 && stats.darkShare > 60 && stats.brightShare > 0.05 && stats.maxSpread < 40
        ? 'MONOCHROME ✓'
        : 'CHECK ✗'
    console.log(
      `${f}: lum=${stats.meanLum} dark=${stats.darkShare}% bright=${stats.brightShare}% spread=${stats.maxSpread} → ${verdict}`,
    )
  }
} finally {
  await browser.close()
}
