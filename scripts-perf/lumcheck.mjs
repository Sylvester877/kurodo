// Quick luminance check for P2 screenshots (proves content, not blank/black).
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox'] })
const p = await b.newPage()
const names = process.argv.slice(2)
for (const name of names) {
  const file = path.join(ROOT, 'screenshots', name)
  if (!fs.existsSync(file)) { console.log(name, 'MISSING'); continue }
  const b64 = fs.readFileSync(file).toString('base64')
  const st = await p.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64
    await new Promise((r) => { img.onload = r })
    const c = document.createElement('canvas'); const W = 220, H = Math.round((img.height / img.width) * 220)
    c.width = W; c.height = H
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H)
    const d = x.getImageData(0, 0, W, H).data
    let sum = 0, n = d.length / 4, black = 0, bright = 0
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]; sum += l; if (l < 12) black++; if (l > 200) bright++ }
    return { mean: Math.round(sum / n), pctBlack: Math.round(1000 * black / n) / 10, pctBright: Math.round(1000 * bright / n) / 10 }
  }, b64)
  console.log(name.padEnd(28), JSON.stringify(st))
}
await b.close()
