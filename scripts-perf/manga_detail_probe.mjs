import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args:['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({width:1280,height:1100})
let errs=[]
p.on('pageerror', e=> errs.push(e.message.slice(0,500)))
p.on('console', m=>{ const t=m.text(); if(/Error|error|185/i.test(t)) errs.push('console:'+t.slice(0,500)) })
await p.goto(url, {waitUntil:'domcontentloaded', timeout:20000})
await new Promise(r=>setTimeout(r,6000))
const info = await p.evaluate(()=>{
  const imgs=[...document.querySelectorAll('img')]
  return imgs.slice(0,6).map(img=>({ src: img.src.slice(0,120), complete: img.complete, nw: img.naturalWidth, nh: img.naturalHeight, loading: img.loading, display: getComputedStyle(img).display, vis: img.offsetParent!==null }))
})
console.log(JSON.stringify(info,null,2))
console.log('errs', errs)
const body = await p.evaluate(()=> document.body.innerText.slice(0,1200))
console.log('BODY snippet', body.slice(0,800))
await p.screenshot({path:'repo/screenshots/manga-detail-strip.png', fullPage:true})
console.log('shot saved')
await b.close()
