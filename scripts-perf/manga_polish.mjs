import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless:'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440,height:900})
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2500))
// Check home, browse, details for manga
await p.goto(`${BASE}/manga`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,4000))
await p.screenshot({path: path.join(OUT, 'polish-manga-browse.png'), fullPage:false})
console.log('saved manga-browse')
// Check pill typography
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,7000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('No Thanks')); if(b) b.click() })
await new Promise(r=>setTimeout(r,600))
const pillInfo = await p.evaluate(()=> {
  const pill=document.querySelector('[class*="left-1/2"]')
  if(!pill) return {found:false, html: document.body.innerHTML.slice(0,1200)}
  const r=pill.getBoundingClientRect()
  const cs=getComputedStyle(pill)
  return {found:true, w:Math.round(r.width), h:Math.round(r.height), radius:cs.borderRadius, bg:cs.backgroundColor, backdrop:cs.backdropFilter, text: pill.innerText.slice(0,80)}
})
console.log('pill', JSON.stringify(pillInfo).slice(0,600))
const spineInfo = await p.evaluate(()=> {
  const s=document.querySelector('[role="progressbar"]')
  if(!s) return {found:false}
  const rect=s.getBoundingClientRect()
  const segs=[...s.querySelectorAll('button')]
  const active=segs.find(b=> getComputedStyle(b).backgroundColor.includes('107, 124, 255'))
  return {found:true, w:Math.round(rect.width), segs:segs.length, activeFound: !!active}
})
console.log('spine', JSON.stringify(spineInfo))
// Test keyboard shortcuts
await p.keyboard.press('m')
await new Promise(r=>setTimeout(r,800))
await p.screenshot({path: path.join(OUT, 'polish-page-mode-switch.png'), fullPage:false})
console.log('saved page-mode-switch')
await p.keyboard.press('m')
await new Promise(r=>setTimeout(r,800))
// Test fullscreen
await p.keyboard.press('f')
await new Promise(r=>setTimeout(r,1000))
await p.screenshot({path: path.join(OUT, 'polish-fullscreen.png'), fullPage:false})
console.log('saved fullscreen')
await p.keyboard.press('Escape')
await new Promise(r=>setTimeout(r,600))
// Test G
await p.keyboard.press('g')
await new Promise(r=>setTimeout(r,1000))
await p.screenshot({path: path.join(OUT, 'polish-full-settings.png'), fullPage:false})
console.log('saved full-settings')
await p.keyboard.press('Escape')
await new Promise(r=>setTimeout(r,600))
// Back to strip
await b.close()
console.log('polish done')
