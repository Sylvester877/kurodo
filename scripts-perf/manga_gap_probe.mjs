import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
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
const metrics = await p.evaluate(()=> {
  const qs = s=> document.querySelector(s)
  const qsa = s=> [...document.querySelectorAll(s)]
  // pill
  const pill = qs('[class*="left-1/2"]')
  const pillRect = pill? pill.getBoundingClientRect(): null
  const pillCS = pill? getComputedStyle(pill): null
  // spine
  const spine = qs('[role="progressbar"]')
  const spineRect = spine? spine.getBoundingClientRect(): null
  const spineSegs = spine? [...spine.querySelectorAll('button')]: []
  const segH = spineSegs[0]? getComputedStyle(spineSegs[0]).height : 'none'
  const active = spineSegs.find(el=> getComputedStyle(el).backgroundColor.includes('107'))
  const activeH = active? getComputedStyle(active).height : 'none'
  // drawer when closed
  const asideClosed = qs('aside')
  // images
  const imgs = qsa('img').filter(i=> i.src.includes('atsu') || i.src.includes('/img'))
  const firstImg = imgs[0]
  const firstRect = firstImg? firstImg.getBoundingClientRect(): null
  const firstCS = firstImg? getComputedStyle(firstImg): null
  // body bg
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor
  const stripContainer = qs('div.flex.flex-col.items-center')
  const stripRect = stripContainer? stripContainer.getBoundingClientRect(): null
  // right stack
  const rightStack = qs('div.fixed.right-3')
  const rightRect = rightStack? rightStack.getBoundingClientRect(): null
  const rightBtns = rightStack? [...rightStack.querySelectorAll('button')].length : 0
  // bottom bar
  const bottom = qs('div.fixed.bottom-0')
  const bottomRect = bottom? bottom.getBoundingClientRect(): null
  return {
    pill: pillRect? {w:Math.round(pillRect.width),h:Math.round(pillRect.height),x:Math.round(pillRect.x),y:Math.round(pillRect.y),bg:pillCS.backgroundColor,radius:pillCS.borderRadius,backdrop:pillCS.backdropFilter,text:pill.innerText.slice(0,60)}: null,
    spine: spineRect? {w:Math.round(spineRect.width),h:Math.round(spineRect.height),segs:spineSegs.length,segH,activeH}: null,
    asideClosed: asideClosed? {found:true,h:Math.round(asideClosed.getBoundingClientRect().height),scrollH:asideClosed.scrollHeight,overflow:getComputedStyle(asideClosed).overflow}: {found:false},
    firstImg: firstRect? {w:Math.round(firstRect.width),h:Math.round(firstRect.height),x:Math.round(firstRect.x),maxW:firstCS.maxWidth,display:firstCS.display,margin:firstCS.margin}: null,
    bodyBg, htmlBg,
    stripRect: stripRect? {w:Math.round(stripRect.width),h:Math.round(stripRect.height)}: null,
    rightStack: rightRect? {x:Math.round(rightRect.x),y:Math.round(rightRect.y),w:Math.round(rightRect.width),h:Math.round(rightRect.height),btns:rightBtns}: null,
    bottom: bottomRect? {h:Math.round(bottomRect.height),y:Math.round(bottomRect.y)}: null,
    viewport:{w:window.innerWidth,h:window.innerHeight},
    imgCount: imgs.length
  }
})
console.log(JSON.stringify(metrics,null,2))
// now open drawer and re-measure
await p.evaluate(()=> {
  const btn=[...document.querySelectorAll('button')].find(b=> b.innerText.includes('Ch.') && b.closest('div.fixed'))
  if(btn) btn.click()
})
await new Promise(r=>setTimeout(r,1200))
await p.screenshot({path: path.join(OUT, 'gap-probe-drawer-open.png'), fullPage:false})
console.log('saved gap-probe-drawer-open')
const drawerMetrics = await p.evaluate(()=> {
  const aside=document.querySelector('aside')
  if(!aside) return {found:false}
  const r=aside.getBoundingClientRect()
  const cs=getComputedStyle(aside)
  // find chapter buttons inside
  const chBtns=[...aside.querySelectorAll('button')].filter(b=> b.innerText.startsWith('Ch.'))
  const chCount=chBtns.length
  const firstCh=chBtns[0]? chBtns[0].getBoundingClientRect(): null
  const chCS=chBtns[0]? getComputedStyle(chBtns[0]): null
  // page thumbs
  const thumbs=[...aside.querySelectorAll('button')].filter(b=> b.querySelector('img'))
  const thumbImgs=[...aside.querySelectorAll('img')].length
  // body scroll lock?
  const bodyOverflow=getComputedStyle(document.body).overflow
  return {
    aside:{w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),bg:cs.backgroundColor,border:cs.borderColor,shadow:cs.boxShadow.slice(0,80)},
    chCount, firstCh: firstCh? {w:Math.round(firstCh.width),h:Math.round(firstCh.height)}: null, chBg: chCS? chCS.backgroundColor: 'none',
    thumbs: thumbs.length, thumbImgs,
    bodyOverflow,
    viewport:{w:window.innerWidth,h:window.innerHeight}
  }
})
console.log('drawer open '+JSON.stringify(drawerMetrics,null,2))
await b.close()
console.log('probe done')
