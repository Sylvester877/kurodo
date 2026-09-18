import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const b = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440, height:900})
const errors=[]
p.on('pageerror', e=> errors.push(e.message.slice(0,400)))
// diagnose why MangaReader not mounting: check route
const url = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
console.log('[diag] goto', url)
await p.goto(url, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,5000))
const loc = await p.evaluate(()=> location.href)
console.log('[diag] location', loc)
console.log('[diag] errors', errors)
const body = await p.evaluate(()=> document.body.innerText.slice(0,800))
console.log('[diag] body', body.slice(0,500))
const hasSetup = await p.evaluate(()=> document.body.innerText.includes('Setup') || document.body.innerText.includes('Welcome'))
console.log('[diag] hasSetup', hasSetup)
const hasMangaReader = await p.evaluate(()=> document.body.innerHTML.includes('MangaReader') || document.body.innerHTML.includes('Page 1'))
console.log('[diag] hasMangaReader', hasMangaReader)
await b.close()
