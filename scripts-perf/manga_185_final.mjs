import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args:['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({width:1280,height:900})
let pageErrors=[]
p.on('pageerror', e=> pageErrors.push(e.message.slice(0,600)))
p.on('console', m=>{ const t=m.text(); if(/Minified React error.*185|Maximum update depth/i.test(t)) pageErrors.push('console:'+t.slice(0,600)) })
await p.goto(url, {waitUntil:'domcontentloaded', timeout:20000})
await new Promise(r=>setTimeout(r,8000))
const body = await p.evaluate(()=> document.body.innerText.slice(0,2000))
const errCount = pageErrors.length
const has185 = pageErrors.some(e=> e.includes('185')) || body.includes('Something went wrong')
console.log('pageErrors', pageErrors)
console.log('has185', has185, 'errCount', errCount)
console.log('PASS', !has185 && errCount===0 ? 'YES — #185 gone' : 'FAIL')
await p.screenshot({path:'repo/screenshots/manga-185-final.png', fullPage:false})
console.log('shot saved')
await b.close()
