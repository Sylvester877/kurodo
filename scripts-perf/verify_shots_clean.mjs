// Confirm the retaken screenshots are wizard-free:
//  • no z-80 overlay in DOM at capture time
//  • poster <img> elements visible (opacity 1)
//  • pixel stats of the saved PNGs: dark theme + real content (luminance
//    spread), not a blurred black veil
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHOTS = path.join(ROOT, 'screenshots')
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 900 })
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('kurodo-setup-done', '1')
  localStorage.setItem('kurodo-setup-shown', '1')
})

await p.goto('http://localhost:5173/search?q=naruto', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 5000))

const state = await p.evaluate(() => {
  let wizardVisible = false
  for (const el of document.querySelectorAll('div.fixed.inset-0')) {
    if (getComputedStyle(el).zIndex === '80') wizardVisible = true
  }
  const imgs = [...document.querySelectorAll('.poster-frame img')].slice(0, 10)
  const visible = imgs.filter((i) => getComputedStyle(i).opacity === '1' && i.complete && i.naturalWidth > 1).length
  return { wizardVisible, postersVisible: visible, posterTotal: imgs.length }
})
console.log('DOM:', JSON.stringify(state))

// Pixel-check every saved redesign screenshot
const files = ['search-redesign-empty.png', 'search-redesign-results.png', 'search-redesign-rail.png', 'search-redesign-filtered.png']
for (const f of files) {
  const fp = path.join(SHOTS, f)
  if (!fs.existsSync(fp)) { console.log(f, 'MISSING'); continue }
  const b64 = fs.readFileSync(fp).toString('base64')
  const stats = await p.evaluate(async (b64) => {
    const resp = await fetch(`data:image/png;base64,${b64}`)
    const bmp = await createImageBitmap(await resp.blob())
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let sum = 0, dark = 0, bright = 0, n = 0
    for (let i = 0; i < data.length; i += 4 * 53) {
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
      sum += lum; if (lum < 0.15) dark++; if (lum > 0.75) bright++; n++
    }
    return { meanLum: +(sum / n).toFixed(3), darkShare: +(dark / n).toFixed(2), brightShare: +(bright / n).toFixed(3) }
  }, b64)
  console.log(f, JSON.stringify(stats))
}

await b.close()
