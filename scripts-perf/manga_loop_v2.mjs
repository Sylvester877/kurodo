import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT,{recursive:true})
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE = 'http://127.0.0.1:5174'
const b = await puppeteer.launch({ headless:'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440,height:900})
// dismiss setup on prod server (no vite overlay, reads from dist so clean)
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> {
  const btn=[...document.querySelectorAll('button')].find(b=> b.innerText.includes('Skip setup'))
  if(btn) btn.click()
})
await new Promise(r=>setTimeout(r,3000))
const url = `${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`
console.log('[v2] goto', url)
await p.goto(url, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,7000))
const diag = await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')].map(b=> b.innerText.slice(0,60))
  const hasCh = btns.some(t=> t.includes('Ch.'))
  const spine = !!document.querySelector('[role="progressbar"]')
  const pill = [...document.querySelectorAll('button')].find(b=> b.innerText.includes('Ch.'))
  const rtStack = document.body.innerHTML.includes('RightToolStack') || document.body.innerHTML.includes('fixed right-3')
  return { hasCh, pillText: pill?.innerText.slice(0,80) || null, spine, btns: btns.slice(0,12), rtStack }
})
console.log(JSON.stringify(diag,null,2))
await p.screenshot({path: path.join(OUT, 'loop-02-reader-v2-closed.png'), fullPage:false})
console.log('saved closed')
// pill -> drawer
const pill = await p.evaluate(()=> {
  const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Ch.'))
  if(b){ b.click(); return b.innerText.slice(0,80) }
  return null
})
console.log('[v2] pill click', pill)
await new Promise(r=>setTimeout(r,1600))
await p.screenshot({path: path.join(OUT, 'loop-02-drawer-chapters.png'), fullPage:false})
console.log('saved drawer-chapters')
// settings tab
await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')]
  const s=btns.find(b=> b.innerText.trim()==='Settings')
  if(s) s.click()
})
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'loop-02-drawer-settings.png'), fullPage:false})
console.log('saved drawer-settings')
// close
await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')]
  const x=btns.find(b=> b.getAttribute('aria-label')==='Close')
  if(x) x.click()
})
await new Promise(r=>setTimeout(r,800))
await p.evaluate(()=> window.scrollTo(0,600))
await new Promise(r=>setTimeout(r,600))
await p.screenshot({path: path.join(OUT, 'loop-02-scrolled.png'), fullPage:false})
console.log('saved scrolled')
await b.close()
console.log('[v2] done')
