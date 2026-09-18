import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args:['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({width:1280,height:900})
let errs=[]
p.on('pageerror', e=> errs.push(e.message.slice(0,400)))
await p.goto(url, { waitUntil:'domcontentloaded', timeout:20000 })
await new Promise(r=>setTimeout(r,9000))
const stats = await p.evaluate(async ()=>{
  const imgs=[...document.querySelectorAll('img')]
  let loaded=0, failed=0, proxy=0
  for(const img of imgs){
    if(img.complete && img.naturalWidth>10) loaded++
    else if(img.complete && img.naturalWidth===0) failed++
    if(img.src.includes('/img?')) proxy++
  }
  const errOverlay=document.body.innerText.slice(0,1500)
  return { total:imgs.length, loaded, failed, proxy, errOverlay: errOverlay.slice(0,600) }
})
console.log(JSON.stringify(stats,null,2))
console.log('pageerrors', errs)
await p.screenshot({path:'repo/screenshots/manga-img-probe.png', fullPage:false})
console.log('shot saved')
await b.close()
