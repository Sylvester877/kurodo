import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const OUT = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless:false, executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440,height:900})
const errs=[]
p.on('pageerror', e=> { errs.push(e.message.slice(0,800)); console.log('[pageerror]', e.message.slice(0,1000)) })
p.on('console', m=> { if(m.type()==='error') console.log('[console.error]', m.text().slice(0,800)) })
// intercept console errors in page
await p.evaluateOnNewDocument(()=> {
  window.addEventListener('error', e=> console.error('[win.error]', e.message, e.error?.stack?.slice(0,800)))
  window.addEventListener('unhandledrejection', e=> console.error('[unhandledrejection]', String(e.reason).slice(0,800)))
})
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2500))
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,8000))
console.log('errs count', errs.length)
for(const e of errs) console.log('---', e.slice(0,1000))
const loc = await p.evaluate(()=> location.href)
console.log('loc', loc)
const text = await p.evaluate(()=> document.body.innerText.slice(0,1500))
console.log('text', text.slice(0,1000))
await new Promise(r=>setTimeout(r,5000))
await b.close()
