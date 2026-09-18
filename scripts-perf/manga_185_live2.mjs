import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1280, height: 900 })
let errs=[]
p.on('pageerror', e=> errs.push('pageerror:'+e.message.slice(0,800)))
p.on('console', m=>{ const t=m.text(); if(/error|Error|185|Maximum/i.test(t)) errs.push('console:'+t.slice(0,800)) })
try{
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await new Promise(r=>setTimeout(r,8000))
  const body = await p.evaluate(()=> document.body.innerText.slice(0,3000))
  const html = await p.evaluate(()=> document.documentElement.innerHTML.slice(0,8000))
  console.log('BODY:', body.slice(0,2000))
  console.log('ERRS:', errs)
  console.log('HAS_CRASH:', body.includes('Something went wrong') || body.includes('Minified React') || errs.length>0)
  await p.screenshot({ path: 'repo/screenshots/manga-185-live2.png', fullPage: true })
  console.log('shot saved')
} catch(e){ console.log('GOTO ERR', e.message) }
await b.close()
