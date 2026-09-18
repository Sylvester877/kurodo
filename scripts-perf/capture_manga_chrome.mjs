import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined

async function chromeShots(url, label){
  const b = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
  const p = await b.newPage()
  await p.setViewport({width:1440,height:900})
  await p.goto(url, {waitUntil:'domcontentloaded', timeout:30000})
  await new Promise(r=>setTimeout(r,7000))
  const info = await p.evaluate(()=>{
    // mangafire: grab reader topbar + footer
    const topbar = document.querySelector('.reader__topbar')?.outerHTML.slice(0,3000) || ''
    const bottom = document.querySelector('.reader__bottombar, .reader__footer, footer')?.outerHTML.slice(0,3000) || ''
    const reader = document.querySelector('.reader')?.outerHTML.slice(0,5000) || ''
    const bodyBg = getComputedStyle(document.body).backgroundColor
    const readerBg = getComputedStyle(document.querySelector('.reader')||document.body).backgroundColor
    const cssVars = (()=>{ const s=getComputedStyle(document.querySelector('.reader')||document.documentElement); return { readerBg: s.getPropertyValue('--reader-bg'), stripMargin: s.getPropertyValue('--strip-margin'), dim: s.getPropertyValue('--reader-dim') } })()
    const pages = [...document.querySelectorAll('img')].slice(0,2).map(i=> ({cls:i.className, style: i.getAttribute('style')?.slice(0,200), parent: i.parentElement?.className.slice(0,100)}))
    return { topbar, bottom, readerHead: reader.slice(0,4000), bodyBg, readerBg, cssVars, pages }
  })
  console.log(`\n===== ${label} CHROME =====`)
  console.log(JSON.stringify(info,null,2))
  // clip topbar + left progress
  const topExists = await p.$('.reader__topbar')
  if(topExists){
    const box = await topExists.boundingBox()
    console.log('topbar box', box)
    await p.screenshot({path: path.join(OUT, `${label}-chrome-topbar.png`), clip: {x: Math.max(0,box.x-8), y: Math.max(0,box.y-8), width: Math.min(1424, box.width+16), height: Math.min(880, box.height+16)}})
    console.log(`saved ${label}-chrome-topbar.png`)
  }
  // full page after
  await p.screenshot({path: path.join(OUT, `${label}-chrome-full.png`), fullPage:true})
  console.log(`saved ${label}-chrome-full.png`)
  await b.close()
}

await chromeShots('https://mangafire.to/title/jjrxn-bleach/chapter/5849566', 'ref-mangafire-chrome')
await chromeShots('https://atsu.moe/read/VRSVH/v0OZrew0#rs=p:3', 'ref-atsu-chrome')
console.log('chrome done')
