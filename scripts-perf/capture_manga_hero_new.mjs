import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox', '--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
await p.goto('http://127.0.0.1:5173/manga', { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r=>setTimeout(r,6000))
fs.mkdirSync(OUT,{recursive:true})
await p.screenshot({ path: path.join(OUT,'manga-hero-onisaga-after-full.png'), fullPage: true })
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
await p.screenshot({ path: path.join(OUT,'manga-hero-onisaga-after-above.png') })
console.log('captured')
await b.close()
