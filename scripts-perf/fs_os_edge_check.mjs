// Native OS-level proof for the fullscreen right-gap fix.
// Loads screenshots/fs-os-native.png (1920x1200 physical pixels from
// CopyFromScreen — what the user's eyes see) and measures the right edge.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHOT = path.join(ROOT, 'screenshots', 'fs-os-native.png')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
const p = await b.newPage()
await p.goto('about:blank')
const b64 = fs.readFileSync(SHOT).toString('base64')
const out = await p.evaluate(async (src) => {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src })
  const w = img.naturalWidth, h = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const colAvg = (x) => {
    let s = 0, n = 0
    for (let y = Math.floor(h * 0.15); y < Math.floor(h * 0.85); y += 3) {
      const d = ctx.getImageData(x, y, 1, 1).data
      s += (d[0] + d[1] + d[2]) / 3; n++
    }
    return s / n
  }
  const last60 = []
  for (let x = w - 60; x < w; x++) last60.push(Math.round(colAvg(x)))
  // Strip detector: columns uniformly near-black over 80% of the height
  const stripCols = []
  for (let x = w - 30; x < w; x++) {
    let dark = 0, tot = 0
    for (let y = Math.floor(h * 0.1); y < Math.floor(h * 0.9); y += 2) {
      const d = ctx.getImageData(x, y, 1, 1).data
      if ((d[0] + d[1] + d[2]) / 3 < 16) dark++
      tot++
    }
    if (dark / tot > 0.97) stripCols.push(x - (w - 30))
  }
  return { w, h, last60, stripCols }
}, 'data:image/png;base64,' + b64)
console.log('native shot:', out.w + 'x' + out.h)
console.log('right-edge 60 col brightness:', JSON.stringify(out.last60))
console.log('full-height near-black strip columns (of last 30):', out.stripCols.length ? JSON.stringify(out.stripCols) : 'NONE')
const edgeAvg = out.last60.slice(-15).reduce((a, b) => a + b, 0) / 15
const innerAvg = out.last60.slice(0, 30).reduce((a, b) => a + b, 0) / 30
console.log('inner avg:', Math.round(innerAvg), '| edge avg:', Math.round(edgeAvg), '| verdict:', edgeAvg < innerAvg * 0.35 ? 'DARK BAND PRESENT' : 'EDGE IS CONTENT — NO GAP')
await b.close()
process.exit(0)
