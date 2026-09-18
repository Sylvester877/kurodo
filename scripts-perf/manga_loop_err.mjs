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
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2500))
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,6000))
// expand stack trace
await p.evaluate(()=> { const btn=[...document.querySelectorAll('button')].find(b=> b.innerText.includes('View stack')); if(btn) btn.click() })
await new Promise(r=>setTimeout(r,1000))
const stack = await p.evaluate(()=> {
  const pre = document.querySelector('pre')
  return pre ? pre.innerText.slice(0,5000) : document.body.innerText.slice(0,4000)
})
console.log(stack)
await p.screenshot({path: path.join(OUT, 'loop-02-error-stack.png'), fullPage:false})
console.log('saved stack')
await b.close()
