import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const b = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440, height:900})
// Dismiss setup first
await p.goto('http://127.0.0.1:5173/', {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
const loc1 = await p.evaluate(()=> location.href)
console.log('[step] home loc', loc1)
const btn = await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')]
  const skip=btns.find(b=> b.innerText.includes('Skip setup') || b.innerText.includes('Skip'))
  if(skip){ skip.click(); return skip.innerText.slice(0,60) }
  return null
})
console.log('[step] skip click', btn)
await new Promise(r=>setTimeout(r,3000))
const loc2 = await p.evaluate(()=> location.href)
console.log('[step] after skip loc', loc2)
// Now go to reader
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
await p.goto(url, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,7000))
const diag = await p.evaluate(()=> {
  const inner = document.body.innerText.slice(0,1000)
  const hasPill = [...document.querySelectorAll('button')].some(b=> b.innerText.includes('Ch.'))
  const spine = !!document.querySelector('[role="progressbar"]')
  const pillBtn = [...document.querySelectorAll('button')].find(b=> b.innerText.includes('Ch.'))
  return { inner: inner.slice(0,600), hasPill, pillText: pillBtn?.innerText.slice(0,60) || null, spine, btnCount: document.querySelectorAll('button').length }
})
console.log(JSON.stringify(diag,null,2))
await p.screenshot({path: path.join(OUT, 'loop-01-reader-after-skip.png'), fullPage:false})
console.log('saved after-skip')
// Click pill to open drawer
const pill = await p.evaluate(()=> {
  const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Ch.'))
  if(b){ b.click(); return b.innerText.slice(0,60) }
  return null
})
console.log('[step] pill click', pill)
await new Promise(r=>setTimeout(r,1500))
await p.screenshot({path: path.join(OUT, 'loop-01-drawer-after-skip.png'), fullPage:false})
console.log('saved drawer-after-skip')
await b.close()
