import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless:'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440,height:900})
const corsErrors=[]
p.on('console', m=> { if(m.type()==='error' && m.text().includes('CORS')) corsErrors.push(m.text().slice(0,120)) })
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2500))
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,9000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('No Thanks')); if(b) b.click() })
await new Promise(r=>setTimeout(r,800))
console.log('[final] CORS errors', corsErrors.length)
console.log(corsErrors.slice(0,3))
// Check proxified urls
const urls = await p.evaluate(()=> [...document.querySelectorAll('img')].slice(0,4).map(i=> i.src.slice(0,120)))
console.log('[final] img srcs', urls)
await p.screenshot({path: path.join(OUT, 'loop-04-final-reader.png'), fullPage:false})
console.log('saved final-reader')
// Drawer chapters - check thumbnails are proxied too
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Ch.')); if(b) b.click() })
await new Promise(r=>setTimeout(r,1600))
const drawerImgs = await p.evaluate(()=> [...document.querySelectorAll('aside img')].slice(0,3).map(i=> i.src.slice(0,120)))
console.log('[final] drawer img srcs', drawerImgs)
await p.screenshot({path: path.join(OUT, 'loop-04-drawer-chapters-final.png'), fullPage:false})
console.log('saved drawer-chapters-final')
// Settings tab
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.trim()==='Settings'); if(b) b.click() })
await new Promise(r=>setTimeout(r,1000))
await p.screenshot({path: path.join(OUT, 'loop-04-drawer-settings-final.png'), fullPage:false})
console.log('saved drawer-settings-final')
await b.close()
console.log('[final] done')
