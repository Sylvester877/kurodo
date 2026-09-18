import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })

async function waitForVideo(timeout=35000){
  const start=Date.now()
  while(Date.now()-start < timeout){
    const has = await p.evaluate(()=> !!document.querySelector('video'))
    if(has) return true
    await new Promise(r=>setTimeout(r,500))
  }
  return false
}

async function hoverControls(){
  // move to bottom-center of viewport where controls live
  await p.mouse.move(720, 820)
  await new Promise(r=>setTimeout(r, 900))
  // also dispatch mousemove on player wrap to trigger visible
  await p.evaluate(()=>{
    const wrap=document.querySelector('.group.relative.w-full.overflow-hidden')
    if(wrap){ wrap.dispatchEvent(new MouseEvent('mousemove',{bubbles:true})) }
  })
  await new Promise(r=>setTimeout(r,600))
}

await p.goto(`${BASE}/watch/21?ep=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
console.log('goto watch 21')
const hasVideo = await waitForVideo()
console.log('hasVideo:', hasVideo)
await hoverControls()

if(!hasVideo){
  // still screenshot what we have
  const bodyText = await p.evaluate(()=> document.body.innerText.slice(0,1200))
  console.log('no video body:', bodyText.slice(0,800))
  await p.screenshot({ path: path.join(OUT, 'anikage-menu-ERR-no-video.png'), fullPage: false })
  await b.close(); process.exit(0)
}

// log controls state
const diag = await p.evaluate(()=>{
  const btns=[...document.querySelectorAll('button')].map(b=> b.getAttribute('aria-label')||b.getAttribute('title')||'').filter(Boolean)
  const caps=[...document.querySelectorAll('button')].filter(b=> (b.getAttribute('aria-label')||'').toLowerCase().includes('caption'))
  const sets=[...document.querySelectorAll('button')].filter(b=> (b.getAttribute('aria-label')||'').toLowerCase().includes('setting'))
  const chips=[...document.querySelectorAll('div.rounded-full.bg-black\\/60')]
  const trackEls=[...document.querySelectorAll('track')]
  const v=document.querySelector('video')
  const subsInfo = v ? { paused: v.paused, src: v.currentSrc.slice(0,120), tracks: [...(v.textTracks||[])].map(t=>({label:t.label, mode:t.mode})) } : null
  return { btns, capsCount: caps.length, setsCount: sets.length, chips: chips.length, trackEls: trackEls.length, subsInfo, allBtnAria: [...document.querySelectorAll('button[aria-label]')].map(b=>b.getAttribute('aria-label')) }
})
console.log(JSON.stringify(diag,null,2))

// 1) bar playing
await p.screenshot({ path: path.join(OUT, 'anikage-menu-01-bar-playing.png'), fullPage: false })
console.log('saved 01')

// try to ensure stream has subs — if 0, click a provider that has subs
// wait a bit more for stream resolve (yuki etc)
await new Promise(r=>setTimeout(r, 3000))
await hoverControls()
const subsCount = await p.evaluate(()=> document.querySelectorAll('track').length)
console.log('track count after wait:', subsCount)

// 2) volume hover — move over mute button
const volPos = await p.evaluate(()=>{
  const btn=[...document.querySelectorAll('button')].find(b=> (b.getAttribute('aria-label')||'') === 'Mute' || (b.getAttribute('aria-label')||'')==='Unmute')
  if(!btn) return null
  const r=btn.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}
})
console.log('volPos',volPos)
if(volPos){ await p.mouse.move(volPos.x, volPos.y); await new Promise(r=>setTimeout(r,700)) }
await p.screenshot({ path: path.join(OUT, 'anikage-menu-02-volume-hover.png'), fullPage: false })
console.log('saved 02 volume hover')
await hoverControls()

// 3) Captions menu
let ccClicked = await p.evaluate(()=>{
  let btn=[...document.querySelectorAll('button[aria-label=\"Captions\"]')][0]
  if(!btn) btn=[...document.querySelectorAll('button')].find(b=> (b.getAttribute('title')||'').toLowerCase().includes('caption'))
  if(btn){ btn.click(); return btn.getAttribute('aria-label')||btn.getAttribute('title')||'found' }
  return false
})
console.log('ccClicked:', ccClicked)
await new Promise(r=>setTimeout(r,1000))
let ccVisible = await p.evaluate(()=> {
  const panel=[...document.querySelectorAll('div')].find(d=> d.textContent.includes('Captions') && d.className.includes('backdrop-blur'))
  return !!panel
})
console.log('ccVisible:', ccVisible)
await p.screenshot({ path: path.join(OUT, 'anikage-menu-03-captions.png'), fullPage: false })
console.log('saved 03 captions')

// appearance drill-in
let appClicked = await p.evaluate(()=>{
  const btn=[...document.querySelectorAll('button')].find(b=> b.textContent.trim().startsWith('Appearance'))
  if(btn){ btn.click(); return true }
  return false
})
console.log('appearanceClicked:', appClicked)
if(appClicked){
  await new Promise(r=>setTimeout(r,800))
  await p.screenshot({ path: path.join(OUT, 'anikage-menu-04-captions-appearance.png'), fullPage: false })
  console.log('saved 04 appearance')
  // close
  await p.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,500))
} else {
  await p.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,500))
}
await hoverControls()

// 4) Settings
let setClicked = await p.evaluate(()=>{
  let btn=[...document.querySelectorAll('button[aria-label=\"Settings\"]')][0]
  if(!btn) btn=[...document.querySelectorAll('button')].find(b=> (b.getAttribute('title')||'').toLowerCase().includes('setting'))
  if(btn){ btn.click(); return btn.getAttribute('aria-label')||btn.getAttribute('title')||'found' }
  return false
})
console.log('setClicked:', setClicked)
await new Promise(r=>setTimeout(r,1000))
let setVisible = await p.evaluate(()=> document.body.innerText.includes('Speed') && document.body.innerText.includes('Quality'))
console.log('setVisible:', setVisible)
await p.screenshot({ path: path.join(OUT, 'anikage-menu-05-settings.png'), fullPage: false })
console.log('saved 05 settings')
await p.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,500))
await hoverControls()

// 5) Timeline hover — find timeline
let tlPos = await p.evaluate(()=>{
  // timeline is the 5px track with group class
  const els=[...document.querySelectorAll('div')]
  // find the div with h-[5px] and bg-white/20
  const cand = document.querySelector('div.h-\\[5px\\]')
  if(cand){ const r=cand.getBoundingClientRect(); return {x:r.left+r.width*0.45, y:r.top+r.height/2} }
  return null
})
console.log('tlPos', tlPos)
if(tlPos){ await p.mouse.move(tlPos.x, tlPos.y); await new Promise(r=>setTimeout(r,700)) }
await p.screenshot({ path: path.join(OUT, 'anikage-menu-06-timeline-hover.png'), fullPage: false })
console.log('saved 06 timeline')

// 6) center play — pause
await p.evaluate(()=> { const v=document.querySelector('video'); if(v && !v.paused) v.pause() })
await new Promise(r=>setTimeout(r,800))
await p.mouse.move(720, 400)
await new Promise(r=>setTimeout(r,400))
await p.screenshot({ path: path.join(OUT, 'anikage-menu-07-center-play.png'), fullPage: false })
console.log('saved 07 center')

await b.close()
console.log('done')
