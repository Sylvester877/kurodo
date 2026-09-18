import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE='http://127.0.0.1:5173'
const b=await puppeteer.launch({headless:'new', executablePath:chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900']})
const p=await b.newPage()
await p.setViewport({width:1440,height:900})
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`,{waitUntil:'domcontentloaded',timeout:25000})
await new Promise(r=>setTimeout(r,7500))
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('No Thanks')); if(b) b.click()})
await new Promise(r=>setTimeout(r,800))
const info=await p.evaluate(()=>{
  const nav=document.querySelector('nav, header.fixed, div.fixed.top-0')
  const navRect=nav?nav.getBoundingClientRect():null
  const navText=nav?nav.innerText.slice(0,120):'none'
  const pill=document.querySelector('[class*="left-1/2"]')
  const pillRect=pill?pill.getBoundingClientRect():null
  const overlap = navRect && pillRect ? (navRect.bottom > pillRect.top) : null
  // check bottom bar overlap with last image
  const imgs=[...document.querySelectorAll('img')].filter(i=>i.src.includes('atsu')||i.src.includes('/img'))
  const lastImg=imgs[imgs.length-1]
  const lastRect=lastImg?lastImg.getBoundingClientRect():null
  const bottom=document.querySelector('div.fixed.bottom-0')
  const bottomRect=bottom?bottom.getBoundingClientRect():null
  const bottomOverlap = lastRect && bottomRect ? (lastRect.bottom > bottomRect.top) : null
  // chapter list count
  const aside=document.querySelector('aside')
  // not open, so check drawer trigger
  return {nav:{h:navRect?Math.round(navRect.height):0,y:navRect?Math.round(navRect.y):0,text:navText.slice(0,60)},pill:{y:pillRect?Math.round(pillRect.y):0},overlap,bottomOverlap,imgCount:imgs.length,lastImgY:lastRect?Math.round(lastRect.y):0,lastH:lastRect?Math.round(lastRect.height):0,bottomY:bottomRect?Math.round(bottomRect.y):0}
})
console.log(JSON.stringify(info,null,2))
// screenshot with navbar visible
await p.screenshot({path:path.join(OUT,'phase2-navbar-overlap.png'),fullPage:false})
console.log('saved phase2-navbar-overlap.png')
// check mangadex browse vs atsu browse
await p.goto(`${BASE}/manga`,{waitUntil:'domcontentloaded',timeout:25000})
await new Promise(r=>setTimeout(r,4000))
await p.screenshot({path:path.join(OUT,'phase2-manga-browse-full.png'),fullPage:true})
console.log('saved phase2-manga-browse-full.png')
const browseInfo=await p.evaluate(()=>{
  const cards=[...document.querySelectorAll('a')].filter(a=>a.href.includes('/manga/')).slice(0,6)
  return {cardCount:cards.length, firstCard: cards[0]? cards[0].innerHTML.slice(0,400):'none', url: location.href}
})
console.log(JSON.stringify(browseInfo,null,2))
await b.close()
console.log('phase2 probe done')
