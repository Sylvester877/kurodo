// Downscale a screenshot PNG via Chrome canvas so it can be viewed.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'

const [src, dst, maxW] = process.argv.slice(2)
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
const p = await b.newPage()
const dataUri = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64')
const out = await p.evaluate(async (uri, mw) => {
  const img = new Image()
  img.src = uri
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej })
  const scale = Math.min(1, mw / img.width)
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}, dataUri, Number(maxW || 1100))
fs.mkdirSync(path.dirname(dst), { recursive: true })
fs.writeFileSync(dst, Buffer.from(out.split(',')[1], 'base64'))
console.log('saved', dst, fs.statSync(dst).size, 'bytes')
await b.close()
process.exit(0)
