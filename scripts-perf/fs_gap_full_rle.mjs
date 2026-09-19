// Full-row run-length map of the OS screenshot center row — where does
// non-black content actually sit?
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const file = path.join(ROOT, 'screenshots', 'fs-os-desktop.png')
const b64 = fs.readFileSync(file).toString('base64')

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setContent(`<img id=i src="data:image/png;base64,${b64}">`)
await p.waitForSelector('#i')
const res = await p.evaluate(`(async () => {
  const img = document.getElementById('i')
  await img.decode()
  const W = img.naturalWidth, H = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, W, H).data
  const rowRuns = (y) => {
    const runs = []
    let cur = null
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const isBlack = Math.max(d[i], d[i+1], d[i+2]) < 24
      if (!cur || cur.black !== isBlack) { if (cur) runs.push(cur); cur = { black: isBlack, from: x, to: x } }
      else cur.to = x
    }
    if (cur) runs.push(cur)
    return runs.filter((r) => r.to - r.from > 4)
  }
  const colRuns = (x) => {
    const runs = []
    let cur = null
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4
      const isBlack = Math.max(d[i], d[i+1], d[i+2]) < 24
      if (!cur || cur.black !== isBlack) { if (cur) runs.push(cur); cur = { black: isBlack, from: y, to: y } }
      else cur.to = y
    }
    if (cur) runs.push(cur)
    return runs.filter((r) => r.to - r.from > 4)
  }
  return { W, H, rowY480: rowRuns(480), rowY300: rowRuns(300), colX768: colRuns(768) }
})()`)
await b.close()
const fmt = (runs) => runs.map((r) => `${r.black ? 'BLACK' : 'PIC'} ${r.from}-${r.to} (${r.to - r.from + 1}px)`).join(' | ')
console.log('row y=480:', fmt(res.rowY480))
console.log('row y=300:', fmt(res.rowY300))
console.log('col x=768:', fmt(res.colX768))
console.log('frame:', res.W, 'x', res.H)
