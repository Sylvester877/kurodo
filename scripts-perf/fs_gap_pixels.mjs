// Decode the right-edge strip of fs-gap-fullscreen.png via Chrome canvas:
// a real gap = columns of pure black at the frame's right edge.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const file = path.join(ROOT, 'screenshots', 'fs-gap-fullscreen.png')
const b64 = fs.readFileSync(file).toString('base64')

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
const p = await b.newPage()
await p.setContent(`<img id=i src="data:image/png;base64,${b64}">`)
await p.waitForSelector('#i')
const res = await p.evaluate(`(async () => {
  const img = document.getElementById('i')
  await img.decode()
  const c = document.createElement('canvas')
  const W = img.naturalWidth, H = img.naturalHeight
  c.width = W; c.height = H
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  // Sample 6 columns: 5 thin strips at the right edge + one at center
  const cols = [W - 1, W - 2, W - 5, W - 12, W - 30, Math.floor(W / 2)]
  const out = {}
  for (const x of cols) {
    let black = 0, n = 0
    for (let y = 0; y < H; y += 4) {
      const d = ctx.getImageData(x, y, 1, 1).data
      n++
      if (d[0] < 8 && d[1] < 8 && d[2] < 8) black++
    }
    out['col@' + (W - x) + 'pxFromRight'] = Math.round((black / n) * 100) + '% black'
  }
  return { W, H, ...out }
})()`)
await b.close()
console.log('frame:', res.W, 'x', res.H)
Object.entries(res).filter(([k]) => k.startsWith('col@')).forEach(([k, v]) => console.log(' ', k.padEnd(18), v))
const edge = res['col@1pxFromRight']
const center = res['col@' + (res.W / 2 - (res.W % 2)) + 'pxFromRight'] || Object.entries(res).find(([k]) => k.includes('center'))?.[1]
const edgeBlack = parseInt(edge) === 100
console.log(edgeBlack ? '\n❌ right edge is pure black — gap still there' : '\n✅ right edge has picture — NO gap')
