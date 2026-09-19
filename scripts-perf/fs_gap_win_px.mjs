// Windowed control: exact right/left black bands of the PLAYER BOX in
// the windowed screenshot (frame-relative, inside the box's borders).
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const file = path.join(ROOT, 'screenshots', 'fs-gap-windowed.png')
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
  // scan the horizontal line at vertical center of the player area (~y=340)
  // find the box edges first: the player is the large dark region
  const y0 = 340
  const rowVals = []
  for (let x = 0; x < W; x++) { const i = (y0 * W + x) * 4; rowVals.push(Math.max(d[i], d[i+1], d[i+2])) }
  // picture = colorful content; find rightmost x with non-black picture before x=900 (box right edge ~897)
  // report black run at the box's right edge between x=850..910
  const tail = []
  for (let x = 880; x <= 910; x++) tail.push(x + ':' + rowVals[x])
  return { W, H, tail }
})()`)
await b.close()
console.log('windowed frame:', res.W, 'x', res.H)
console.log('row y=340, x=880..910 max-RGB:', res.tail.join(' '))
