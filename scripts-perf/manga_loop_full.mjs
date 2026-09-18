import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless:'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440,height:900})
const errs=[]
p.on('pageerror', e=> errs.push(e.message.slice(0,400)))
p.on('console', m=> { if(m.type()==='error') console.log('[console.error]', m.text().slice(0,600)) })
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2500))
// Reader closed state
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,8000))
console.log('[full] errs', errs.length, errs.slice(0,2))
const spine = await p.evaluate(()=> !!document.querySelector('[role="progressbar"]'))
const hasPill = await p.evaluate(()=> [...document.querySelectorAll('button')].some(b=> b.innerText.includes('Ch.')))
console.log('[full] spine', spine, 'hasPill', hasPill)
// dismiss sync dialog if present
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('No Thanks')); if(b) b.click() })
await new Promise(r=>setTimeout(r,800))
await p.screenshot({path: path.join(OUT, 'loop-03-reader-closed.png'), fullPage:false})
console.log('saved closed')
// open drawer via pill
const pillText = await p.evaluate(()=> {
  const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Ch.'))
  if(b){ b.click(); return b.innerText.slice(0,80) }
  return null
})
console.log('[full] pill', pillText)
await new Promise(r=>setTimeout(r,1600))
await p.screenshot({path: path.join(OUT, 'loop-03-drawer-chapters.png'), fullPage:false})
console.log('saved drawer-chapters')
// settings tab in drawer
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.trim()==='Settings'); if(b) b.click() })
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'loop-03-drawer-settings.png'), fullPage:false})
console.log('saved drawer-settings')
// comments tab
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Comments')); if(b) b.click() })
await new Promise(r=>setTimeout(r,800))
await p.screenshot({path: path.join(OUT, 'loop-03-drawer-comments.png'), fullPage:false})
console.log('saved drawer-comments')
// close drawer then test spine jump
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.getAttribute('aria-label')==='Close'); if(b) b.click() })
await new Promise(r=>setTimeout(r,800))
// page mode check
await p.evaluate(()=> window.scrollTo(0,0))
await new Promise(r=>setTimeout(r,400))
await p.screenshot({path: path.join(OUT, 'loop-03-reader-top.png'), fullPage:false})
console.log('saved top')
// Try spine click (first segment) - should jump to page 0
const spineJump = await p.evaluate(()=> {
  const segs=[...document.querySelectorAll('[role="progressbar"] button')]
  if(segs.length>1){ segs[segs.length-1].click(); return segs.length }
  return segs.length
})
console.log('[full] spine segments', spineJump)
await new Promise(r=>setTimeout(r,800))
await p.screenshot({path: path.join(OUT, 'loop-03-spine-jump.png'), fullPage:false})
console.log('saved spine-jump')
await b.close()
console.log('[full] done')
