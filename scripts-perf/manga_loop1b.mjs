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
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
await p.goto(url, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,6000))
const diag = await p.evaluate(()=> {
  const hasPill = document.body.innerHTML.includes('MangaPill') || [...document.querySelectorAll('button')].some(b=> b.innerText.includes('Ch.'))
  const pills = [...document.querySelectorAll('button')].map(b=> b.innerText.slice(0,80)).slice(0,12)
  const spine = !!document.querySelector('[role="progressbar"]')
  const allBtns = [...document.querySelectorAll('button')].length
  const htmlSnippet = document.body.innerHTML.slice(0,3000)
  return { hasPill, pills, spine, allBtns, htmlSnippet }
})
console.log(JSON.stringify(diag,null,2))
await p.screenshot({path: path.join(OUT, 'loop-01-debug.png'), fullPage:false})
console.log('saved debug')
await b.close()
