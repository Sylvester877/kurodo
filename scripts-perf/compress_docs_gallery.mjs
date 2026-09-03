// Compress docs/*.png (retina 3200x1800 captures) → docs/*.jpg 1600w q82.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DOCS = path.join(ROOT, 'docs')
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()

const pngs = fs.readdirSync(DOCS).filter((f) => f.endsWith('.png'))
for (const f of pngs) {
  const src = path.join(DOCS, f)
  const dest = path.join(DOCS, f.replace(/\.png$/, '.jpg'))
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
  fs.writeFileSync(dest, Buffer.from(outB64, 'base64'))
  console.log(`${path.basename(dest)}  ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`)
  fs.unlinkSync(src) // keep docs/ lean — only the README-facing jpgs stay
}
await b.close()
console.log('DONE')
