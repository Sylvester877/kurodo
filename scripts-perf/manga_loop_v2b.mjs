import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const OUT = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE = 'http://127.0.0.1:5174'
const b = await puppeteer.launch({ headless:'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440,height:900})
const errs=[]
p.on('pageerror', e=> errs.push(e.message.slice(0,600)))
p.on('console', m=> { if(m.type()==='error') console.log('[console.error]', m.text().slice(0,600)) })
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2500))
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,8000))
console.log('errs', errs.slice(0,3))
const diag = await p.evaluate(()=> {
  const text = document.body.innerText.slice(0,1200)
  const html = document.body.innerHTML.slice(0,5000)
  const hasErrorBoundary = document.body.innerText.includes('Something went wrong') || document.body.innerText.includes('Try again')
  return { text: text.slice(0,800), htmlSnippet: html.slice(0,3000), hasErrorBoundary }
})
console.log(JSON.stringify(diag,null,2))
await p.screenshot({path: path.join(OUT, 'loop-02-error.png'), fullPage:false})
console.log('saved error')
await b.close()
