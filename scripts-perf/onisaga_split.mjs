// Split the massive 1920×4921 Onisaga full-page into focused crops so we can
// see hero vs rails without scrolling a tiny 20%-scale page.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

// Ensure the 1920px reference is in dist
fs.copyFileSync(path.join(OUT, 'onisaga-home-2026-09-12-22_52_07.png'), path.join(ROOT, 'dist', 'onisaga-home-2026-09-12-22_52_07.png'))

const html = title => `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;background:#0a0a0a} img{display:block;width:100%;height:auto}</style>
<img src="/onisaga-home-2026-09-12-22_52_07.png">
`

for (const name of ['hero', 'rails', 'mid', 'footer']) {
  const htmlFile = path.join(ROOT, 'dist', `__split_${name}.html`)
  fs.writeFileSync(htmlFile, html(name))
}

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })

// Instead of serving crops via CSS, just screencap the full page at high scale
// and also emit tiled slices via canvas clipping
await p.goto('http://127.0.0.1:5173/__split_hero.html', { waitUntil: 'networkidle2', timeout: 30_000 })
await new Promise(r=> setTimeout(r, 1500))
await p.screenshot({ path: path.join(OUT, 'onisaga-hero-crop.png'), fullPage: false })
console.log('saved onisaga-hero-crop.png (above-fold)')
// scroll to rails band
await p.evaluate(() => window.scrollTo(0, 900))
await new Promise(r=> setTimeout(r, 400))
await p.screenshot({ path: path.join(OUT, 'onisaga-rails-crop.png'), fullPage: false })
console.log('saved onisaga-rails-crop.png (mid)')
await p.evaluate(() => window.scrollTo(0, 1800))
await new Promise(r=> setTimeout(r, 400))
await p.screenshot({ path: path.join(OUT, 'onisaga-mid-crop.png'), fullPage: false })
console.log('saved onisaga-mid-crop.png')
await p.evaluate(() => window.scrollTo(0, 3200))
await new Promise(r=> setTimeout(r, 400))
await p.screenshot({ path: path.join(OUT, 'onisaga-footer-crop.png'), fullPage: false })
console.log('saved onisaga-footer-crop.png')

await b.close()
console.log('Done')
