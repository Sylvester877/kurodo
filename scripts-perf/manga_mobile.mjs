import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless:'new', executablePath: fs.existsSync(CHROME)?CHROME:undefined, args:['--no-sandbox','--disable-gpu','--window-size=390,844'] })
const p = await b.newPage()
// iPhone 14-ish
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, { waitUntil:'domcontentloaded', timeout:25000 })
await new Promise(r=>setTimeout(r,7500))
await p.evaluate(()=> { const btn=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('No Thanks')); if(btn) btn.click() })
await new Promise(r=>setTimeout(r,700))
await p.screenshot({ path: path.join(OUT,'crit-mobile-390-strip.png'), fullPage:false })
console.log('[mobile] saved crit-mobile-390-strip.png')
const pill = await p.evaluate(()=> {
  const el=document.querySelector('[class*="left-1\\/2"]')
  if(!el) return null
  const r=el.getBoundingClientRect()
  const cs=getComputedStyle(el)
  // check truncation
  const inner=[...el.querySelectorAll('span')].map(s=> s.innerText.trim()).filter(Boolean)
  return { w:Math.round(r.width), h:Math.round(r.height), left:Math.round(r.left), right:Math.round(r.right), vw:window.innerWidth, inner, pillText: el.innerText.slice(0,80).replace(/\n/g,' | ') }
})
console.log('[mobile] pill', JSON.stringify(pill))
const toolbar = await p.evaluate(()=> {
  const els=[...document.querySelectorAll('div')]
  const inner=els.find(d=> d.className && (d.className.includes('bottom-') || d.className.includes('safe-area')) && d.querySelector('[aria-label="Settings"]'))
  const el=inner || document.querySelector('[class*="bottom-"]') || [...document.querySelectorAll('div')].find(d=> (d.className||'').includes('bottom-['))
  if(!el) return { found:false, html: document.body.innerHTML.slice(0,800) }
  const r=el.getBoundingClientRect()
  const btns=[...el.querySelectorAll('button')].map(b=> b.getAttribute('aria-label')||b.innerText.slice(0,20))
  return { found:true, w:Math.round(r.width), h:Math.round(r.height), bottom:Math.round(r.bottom), cls: el.className.slice(0,160), btns }
})
console.log('[mobile] toolbar', JSON.stringify(toolbar))
// open drawer on mobile
await p.evaluate(()=> {
  const btn=[...document.querySelectorAll('button')].find(b=> b.innerText.includes('Ch.'))
  if(btn) btn.click()
})
await new Promise(r=>setTimeout(r,1100))
await p.screenshot({ path: path.join(OUT,'crit-mobile-390-drawer.png'), fullPage:false })
console.log('[mobile] saved crit-mobile-390-drawer.png')
// close drawer
await p.evaluate(()=> { const x=[...document.querySelectorAll('button')].find(b=> b.getAttribute('aria-label')==='Close' && b.closest('aside')); if(x) x.click() })
await new Promise(r=>setTimeout(r,700))
// page mode mobile
await p.keyboard.press('m')
await new Promise(r=>setTimeout(r,1100))
await p.screenshot({ path: path.join(OUT,'crit-mobile-390-page.png'), fullPage:false })
console.log('[mobile] saved crit-mobile-390-page.png')
await b.close()
console.log('[mobile] done — 3 shots')
