import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, {recursive:true})
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const b = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440, height:900})
const errors=[]
p.on('pageerror', e=> errors.push(e.message.slice(0,300)))
p.on('console', m=> { if(m.type()==='error') console.log('[console.error]', m.text().slice(0,400)) })
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
console.log('[loop1] goto', url)
await p.goto(url, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,6000))
console.log('[loop1] pageErrors', errors.length, errors.slice(0,2))
const has185 = errors.some(e=> e.includes('185'))
console.log('[loop1] has185', has185)
const spine = await p.evaluate(()=> !!document.querySelector('[role="progressbar"]'))
console.log('[loop1] spine', spine)
await p.screenshot({path: path.join(OUT, 'loop-01-reader-closed.png'), fullPage:false})
console.log('[loop1] saved closed')
const pillBtn = await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')]
  const pill=btns.find(b=> b.innerText.includes('Ch.'))
  if(pill){ pill.click(); return pill.innerText.slice(0,60) }
  return null
})
console.log('[loop1] pill click', pillBtn)
await new Promise(r=>setTimeout(r,1500))
await p.screenshot({path: path.join(OUT, 'loop-01-drawer-chapters.png'), fullPage:false})
console.log('[loop1] saved drawer-chapters')
const tabClicked = await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')]
  const s=btns.find(b=> b.innerText.trim()==='Settings')
  if(s){ s.click(); return true }
  return false
})
console.log('[loop1] settings tab', tabClicked)
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'loop-01-drawer-settings.png'), fullPage:false})
console.log('[loop1] saved drawer-settings')
await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')]
  const x=btns.find(b=> b.getAttribute('aria-label')==='Close')
  if(x) x.click()
})
await new Promise(r=>setTimeout(r,800))
await p.evaluate(()=> window.scrollTo(0,400))
await new Promise(r=>setTimeout(r,600))
await p.screenshot({path: path.join(OUT, 'loop-01-scrolled.png'), fullPage:false})
console.log('[loop1] saved scrolled')
await b.close()
console.log('[loop1] done')
