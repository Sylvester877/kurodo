import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined

async function deep(url, label) {
  const b = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
  const p = await b.newPage()
  await p.setViewport({width:1440, height:900})
  await p.goto(url, {waitUntil:'domcontentloaded', timeout:30000})
  await new Promise(r=>setTimeout(r,7000))
  // dump outerHTML snippets
  const dump = await p.evaluate(()=>{
    const pick = (sel) => [...document.querySelectorAll(sel)].slice(0,8).map(e=> ({
      sel,
      html: e.outerHTML.slice(0,1500).replace(/\s+/g,' '),
      text: e.innerText.slice(0,300).replace(/\s+/g,' '),
      rect: (()=>{ const r=e.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)} })()
    }))
    return {
      title: document.title,
      bodyClasses: document.body.className.slice(0,300),
      htmlClasses: document.documentElement.className.slice(0,300),
      readers: pick('.reader'),
      headers: pick('header'),
      navs: pick('nav'),
      tops: pick('[class*="top"], [class*="header"], [class*="toolbar"]'),
      progress: pick('[class*="progress"]'),
      controls: pick('button, [class*="control"], [class*="zoom"], [class*="page"]'),
      imgs: [...document.querySelectorAll('img')].slice(0,6).map(i=> ({src:i.src.slice(0,120), w:i.naturalWidth, h:i.naturalHeight, cls:i.className.slice(0,80)})),
      allBtns: [...document.querySelectorAll('button')].slice(0,15).map(b=> b.innerText.slice(0,80).replace(/\s+/g,' ') + ' | cls=' + b.className.slice(0,80)),
      styles: [...document.styleSheets].slice(0,3).map(s=> s.href||'(inline)').slice(0,5)
    }
  })
  console.log(`\n===== ${label} =====`)
  console.log(JSON.stringify(dump,null,2))
  // hover top to reveal UI if any
  try { await p.mouse.move(720, 10); await new Promise(r=>setTimeout(r,800)); await p.screenshot({path: path.join(OUT, `${label}-hover-top.png`), fullPage:false}); console.log(`saved ${label}-hover-top.png`)} catch {}
  // scroll down 600
  try { await p.evaluate(()=> window.scrollTo(0,600)); await new Promise(r=>setTimeout(r,800)); await p.screenshot({path: path.join(OUT, `${label}-scrolled.png`), fullPage:false}); console.log(`saved ${label}-scrolled.png`)} catch {}
  // click settings if exists
  try {
    const clicked = await p.evaluate(()=>{
      const b=[...document.querySelectorAll('button')].find(x=> /settings/i.test(x.innerText))
      if(b){ b.click(); return b.innerText.slice(0,50)}
      return null
    })
    if(clicked){ await new Promise(r=>setTimeout(r,1200)); await p.screenshot({path: path.join(OUT, `${label}-settings-open.png`), fullPage:false}); console.log(`settings clicked ${clicked}`)}
  } catch {}
  await b.close()
}

await deep('https://mangafire.to/title/jjrxn-bleach/chapter/5849566', 'deep-mangafire')
await deep('https://atsu.moe/read/VRSVH/v0OZrew0#rs=p:3', 'deep-atsu')
console.log('deep done')
