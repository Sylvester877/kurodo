import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless:'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440,height:900})
const logs=[]
p.on('console', m=> { const t=m.text(); if(t.includes('hook')||t.includes('Render')||t.includes('310')||t.includes('Manga')) logs.push(t.slice(0,800)); })
p.on('pageerror', e=> logs.push('[pageerror]'+e.message.slice(0,800)))
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2500))
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,8000))
console.log(logs.slice(0,20).join('\n'))
const stack = await p.evaluate(()=> {
  const btn=[...document.querySelectorAll('button')].find(b=> b.innerText.includes('View stack'))
  if(btn) btn.click()
  return null
})
await new Promise(r=>setTimeout(r,1500))
const pre = await p.evaluate(()=> document.querySelector('pre')?.innerText.slice(0,6000) || 'no pre')
console.log('---PRE---')
console.log(pre)
await b.close()
