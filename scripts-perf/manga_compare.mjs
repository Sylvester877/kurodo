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
await p.goto(`${BASE}/`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,3000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Skip setup')); if(b) b.click() })
await new Promise(r=>setTimeout(r,2500))
// Test 1: atsu manga reader - strip mode default
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,8000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('No Thanks')); if(b) b.click() })
await new Promise(r=>setTimeout(r,800))
await p.screenshot({path: path.join(OUT, 'compare-atsu-strip.png'), fullPage:false})
console.log('saved atsu-strip')
// Test page mode
await p.evaluate(()=> {
  // Open drawer settings -> switch to page mode
  const pill=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('Ch.'))
  if(pill) pill.click()
})
await new Promise(r=>setTimeout(r,1000))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.trim()==='Settings'); if(b) b.click() })
await new Promise(r=>setTimeout(r,800))
await p.screenshot({path: path.join(OUT, 'compare-drawer-settings-open.png'), fullPage:false})
console.log('saved drawer-settings-open')
// Click page mode in drawer
await p.evaluate(()=> {
  const btns=[...document.querySelectorAll('button')]
  const pageBtn=btns.find(b=> b.innerText.trim().toLowerCase()==='page')
  if(pageBtn) pageBtn.click()
})
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'compare-page-mode.png'), fullPage:false})
console.log('saved page-mode')
// Close drawer
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.getAttribute('aria-label')==='Close'); if(b) b.click() })
await new Promise(r=>setTimeout(r,800))
await p.screenshot({path: path.join(OUT, 'compare-page-mode-closed.png'), fullPage:false})
console.log('saved page-mode-closed')
// Test mangadex manga reader for comparison
await p.goto(`${BASE}/manga/read/0aea3c65-7d3c-4b5e-9f2e-0e8f8b1a2c3d?manga=test&source=mangadex`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,4000))
await p.screenshot({path: path.join(OUT, 'compare-mangadex-empty.png'), fullPage:false})
console.log('saved mangadex-empty')
// Back to atsu - test right tool stack visibility
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,5000))
const rt = await p.evaluate(()=> {
  const stack = document.querySelector('.fixed.right-3')
  if(!stack) return {found:false}
  const rect = stack.getBoundingClientRect()
  return {found:true, top: Math.round(rect.top), right: Math.round(rect.right), height: Math.round(rect.height), btns: stack.querySelectorAll('button').length}
})
console.log('rightStack', JSON.stringify(rt))
// Test keyboard G
await p.keyboard.press('g')
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'compare-keyboard-G.png'), fullPage:false})
console.log('saved keyboard-G')
await b.close()
console.log('compare done')
