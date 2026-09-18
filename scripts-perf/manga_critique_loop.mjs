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
const log = (m)=> console.log(`[critique] ${m}`)

// go home, dismiss setup
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2000))

// 1 manga browse
await p.goto(`${BASE}/manga`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,4000))
await p.screenshot({path: path.join(OUT, 'crit-manga-browse.png'), fullPage:false})
log('saved crit-manga-browse.png')

// 2 reader strip closed
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,7500))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('No Thanks')); if(b) b.click() })
await new Promise(r=>setTimeout(r,600))
await p.screenshot({path: path.join(OUT, 'crit-reader-strip-closed.png'), fullPage:false})
log('saved crit-reader-strip-closed.png')

// pill metrics
const pill = await p.evaluate(()=> {
  const el=document.querySelector('[class*="left-1/2"]')
  if(!el) return null
  const r=el.getBoundingClientRect(); const cs=getComputedStyle(el)
  return {w:Math.round(r.width), h:Math.round(r.height), radius:cs.borderRadius, bg:cs.backgroundColor, text: el.innerText.slice(0,60).replace(/\n/g,' | ')}
})
log(`pill ${JSON.stringify(pill)}`)
const spine = await p.evaluate(()=> {
  const s=document.querySelector('[role="progressbar"]')
  if(!s) return null
  const segs=[...s.querySelectorAll('button')]
  return {segs: segs.length, w: Math.round(s.getBoundingClientRect().width)}
})
log(`spine ${JSON.stringify(spine)}`)

// 3 drawer chapters
await p.evaluate(()=> {
  const btn=[...document.querySelectorAll('button')].find(b=> b.innerText.includes('Ch.'))
  if(btn) btn.click()
})
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'crit-drawer-chapters.png'), fullPage:false})
log('saved crit-drawer-chapters.png')

// check drawer header / tabs
const drawerInfo = await p.evaluate(()=> {
  const aside=document.querySelector('aside')
  if(!aside) return {found:false}
  const rect=aside.getBoundingClientRect()
  const tabs=[...aside.querySelectorAll('button')].map(b=> b.innerText.trim()).filter(Boolean).slice(0,8)
  return {found:true, w:Math.round(rect.width), h:Math.round(rect.height), tabs}
})
log(`drawer ${JSON.stringify(drawerInfo)}`)

// 4 drawer settings tab
await p.evaluate(()=> {
  const btn=[...document.querySelectorAll('button')].find(b=> b.innerText.includes('Settings') && b.closest('aside'))
  if(btn) btn.click()
})
await new Promise(r=>setTimeout(r,800))
await p.screenshot({path: path.join(OUT, 'crit-drawer-settings.png'), fullPage:false})
log('saved crit-drawer-settings.png')

// close drawer via backdrop or X
await p.evaluate(()=> {
  const x=[...document.querySelectorAll('button')].find(b=> b.getAttribute('aria-label')==='Close' && b.closest('aside'))
  if(x) x.click()
})
await new Promise(r=>setTimeout(r,800))

// 5 page mode (press m)
await p.keyboard.press('m')
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'crit-page-mode.png'), fullPage:false})
log('saved crit-page-mode.png')
const pageModeInfo = await p.evaluate(()=> {
  const imgs=document.querySelectorAll('img')
  const readerImgs=[...imgs].filter(i=> i.src.includes('atsu') || i.src.includes('/img') || i.alt?.startsWith('Page'))
  return {totalImgs: imgs.length, readerImgs: readerImgs.length, firstSrc: readerImgs[0]?.src?.slice(0,80) || 'none'}
})
log(`pageMode ${JSON.stringify(pageModeInfo)}`)

// 6 drawer on page mode -> settings full
await p.keyboard.press('g')
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'crit-page-settings-full.png'), fullPage:false})
log('saved crit-page-settings-full.png')
await p.keyboard.press('Escape')
await new Promise(r=>setTimeout(r,600))

// 7 back to strip, scroll a bit
await p.keyboard.press('m')
await new Promise(r=>setTimeout(r,800))
await p.evaluate(()=> window.scrollBy(0, 900))
await new Promise(r=>setTimeout(r,900))
await p.screenshot({path: path.join(OUT, 'crit-strip-scrolled.png'), fullPage:false})
log('saved crit-strip-scrolled.png')

// 8 fullscreen
await p.keyboard.press('f')
await new Promise(r=>setTimeout(r,1100))
await p.screenshot({path: path.join(OUT, 'crit-fullscreen.png'), fullPage:false})
log('saved crit-fullscreen.png')
await p.evaluate(()=> { if(document.fullscreenElement) document.exitFullscreen() })
await new Promise(r=>setTimeout(r,600))

// 9 atsu vs mangafire gap check: background color
const bg = await p.evaluate(()=> getComputedStyle(document.body).backgroundColor + ' | ' + getComputedStyle(document.documentElement).backgroundColor)
log(`bg ${bg}`)

await b.close()
log('critique done — 9 shots')
