import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless:'new', executablePath: chromePath, args:['--no-sandbox','--disable-gpu','--window-size=1440,900'] })
const p = await b.newPage()
await p.setViewport({width:1440,height:900})
await p.goto(`${BASE}/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13`, {waitUntil:'domcontentloaded', timeout:25000})
await new Promise(r=>setTimeout(r,7500))
await p.evaluate(()=> { const b=[...document.querySelectorAll('button')].find(x=> x.innerText.includes('No Thanks')); if(b) b.click() })
await new Promise(r=>setTimeout(r,800))
const fixedInfo = await p.evaluate(()=> {
  const all = [...document.querySelectorAll('*')].filter(el=> {
    const cs=getComputedStyle(el)
    return cs.position==='fixed'
  })
  return all.map(el=> {
    const r=el.getBoundingClientRect()
    const cs=getComputedStyle(el)
    // get small identifier
    const id = el.className?.toString().slice(0,80) || el.tagName
    const text = (el.innerText||'').slice(0,30).replace(/\n/g,'|')
    return {id, pos:cs.position, top:cs.top, bottom:cs.bottom, left:cs.left, right:cs.right, w:Math.round(r.width), h:Math.round(r.height), x:Math.round(r.x), y:Math.round(r.y), transform:cs.transform.slice(0,40), text}
  })
})
console.log(JSON.stringify(fixedInfo,null,2))
// also check ancestors of pill for transform/filter
const ancestorInfo = await p.evaluate(()=> {
  const pill=document.querySelector('[class*="left-1/2"]')
  if(!pill) return null
  let cur=pill.parentElement
  const chain=[]
  while(cur && chain.length<10){
    const cs=getComputedStyle(cur)
    chain.push({tag:cur.tagName, cls: cur.className.toString().slice(0,60), transform:cs.transform.slice(0,30), filter:cs.filter.slice(0,30), willChange:cs.willChange})
    cur=cur.parentElement
  }
  return chain
})
console.log('ancestors pill', JSON.stringify(ancestorInfo,null,2))
await b.close()
console.log('done')
