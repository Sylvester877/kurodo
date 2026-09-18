import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox', '--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })

// 1) Watch playing — controls visible (hover to show bar), CC showing
let provs=[]
try {
  const r = await fetch(`${BASE}/api/anidap/servers/21?type=sub`)
  const t = await r.text()
  try { const j=JSON.parse(t); provs=j.providers||j.servers||[]; console.log('providers:', provs.length, provs.slice(0,3).map(x=>x.name||x.id)) } catch{ console.log('servers non-json len', t.length, t.slice(0,120)) }
} catch(e){ console.log('servers fetch fail', String(e).slice(0,150)) }
let watchUrl = `${BASE}/watch/21?ep=1`

await p.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r=>setTimeout(r, 9000))
await p.mouse.move(720, 750)
// wait for controls
await new Promise(r=>setTimeout(r, 1500))
const bar = await p.evaluate(()=> !!document.querySelector('[class*=\"bg-black/60\"]'))
console.log('bar chips present:', bar)
await p.screenshot({ path: path.join(OUT, 'anikage-final-watch-playing.png'), fullPage: false })
console.log('saved anikage-final-watch-playing.png')

// 2) CC menu open
const ccBtn = await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')].find(b=> b.getAttribute('aria-label')==='Captions')
  if(btns){ btns.click(); return true } return false
})
console.log('cc click:', ccBtn)
await new Promise(r=>setTimeout(r, 1200))
await p.screenshot({ path: path.join(OUT, 'anikage-final-watch-ccopen.png'), fullPage: false })
console.log('saved ccopen')

// 3) Settings gear open — close captions first then open settings
await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')].find(b=> b.getAttribute('aria-label')==='Captions')
  if(btns) btns.click()
})
await new Promise(r=>setTimeout(r, 400))
const settingsClicked = await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')].find(b=> b.getAttribute('aria-label')==='Settings')
  if(btns){ btns.click(); return true } return false
})
console.log('settings click:', settingsClicked)
await new Promise(r=>setTimeout(r, 1200))
await p.screenshot({ path: path.join(OUT, 'anikage-final-watch-settings.png'), fullPage: false })
console.log('saved settings')

// 4) Home with ambient taste check
await p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise(r=>setTimeout(r, 3500))
await p.screenshot({ path: path.join(OUT, 'anikage-final-home.png'), fullPage: false })
console.log('saved home')

await b.close()
