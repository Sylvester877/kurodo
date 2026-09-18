import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })

// Make fresh contexts skip the wizard even before any JS runs
await p.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('kurodo-setup-done', '1')
    localStorage.setItem('kurodo-setup-shown', '1')
  } catch {}
})

async function dismissWizard() {
  // Try both localStorage + clicking skip buttons for robustness
  try { await p.evaluate(() => { try { localStorage.setItem('kurodo-setup-done','1'); localStorage.setItem('kurodo-setup-shown','1') } catch {} }) } catch {}
  await new Promise(r=>setTimeout(r, 300))
  const clicked = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const skip = btns.find(b => b.textContent.trim() === 'Skip setup' || b.textContent.trim() === 'Skip')
    // prefer Skip setup
    let target = btns.find(b => b.textContent.includes('Skip setup'))
    if (!target) target = btns.find(b => b.textContent.trim() === 'Skip')
    if (target) { target.click(); return target.textContent.trim() }
    // also check for the overlay container to ensure it existed
    const overlay = document.querySelector('div.fixed.inset-0.z-\\[80\\]')
    return overlay ? 'overlay-present-no-btn' : false
  })
  if (clicked) console.log('wizard dismiss:', clicked)
  await new Promise(r=>setTimeout(r, 600))
  const still = await p.evaluate(() => !!document.querySelector('div.fixed.inset-0.z-\\[80\\]'))
  console.log('wizard still present after dismiss?', still)
  return !still
}

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
  await p.mouse.move(720, 820)
  await new Promise(r=>setTimeout(r,900))
  await p.evaluate(()=>{
    const wrap=document.querySelector('.group.relative.w-full.overflow-hidden')
    if(wrap) wrap.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}))
  })
  await new Promise(r=>setTimeout(r,600))
}

await p.goto(`${BASE}/watch/21?ep=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
console.log('goto watch 21')
await dismissWizard()
const hasVideo = await waitForVideo()
console.log('hasVideo:', hasVideo)
await hoverControls()

const diag = await p.evaluate(()=>{
  const btns=[...document.querySelectorAll('button')].map(b=> b.getAttribute('aria-label')||b.getAttribute('title')||'').filter(Boolean)
  const wizard = !!document.querySelector('div.fixed.inset-0.z-\\[80\\]')
  const v=document.querySelector('video')
  const chips=[...document.querySelectorAll('div.rounded-full.bg-black\\/60')]
  return { wizard, btns: btns.slice(0,20), chips: chips.length, hasVideo: !!v, tracks: v ? [...(v.textTracks||[])].map(t=>({label:t.label, mode:t.mode})) : [] }
})
console.log(JSON.stringify(diag,null,2))

// 1) bar playing
await p.screenshot({ path: path.join(OUT, 'anikage-menu-01-bar-playing.png'), fullPage: false })
console.log('saved 01 bar playing — wizard gone?', !diag.wizard)

// wait for subs warm
await new Promise(r=>setTimeout(r,2500))
await hoverControls()

// 2) volume hover
const volPos = await p.evaluate(()=>{
  const btn=[...document.querySelectorAll('button')].find(b=> (b.getAttribute('aria-label')||'') === 'Mute' || (b.getAttribute('aria-label')||'')==='Unmute')
  if(!btn) return null
  const r=btn.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}
})
console.log('volPos',volPos)
if(volPos){ await p.mouse.move(volPos.x, volPos.y); await new Promise(r=>setTimeout(r,700)) }
await p.screenshot({ path: path.join(OUT, 'anikage-menu-02-volume-hover.png'), fullPage: false })
console.log('saved 02 volume')
await hoverControls()

// 3) Captions
let ccClicked = await p.evaluate(()=>{
  let btn=[...document.querySelectorAll('button[aria-label="Captions"]')][0]
  if(!btn) btn=[...document.querySelectorAll('button')].find(b=> (b.getAttribute('title')||'').toLowerCase().includes('caption'))
  if(btn){ btn.click(); return true }
  return false
})
console.log('ccClicked:', ccClicked)
await new Promise(r=>setTimeout(r,1000))
await p.screenshot({ path: path.join(OUT, 'anikage-menu-03-captions.png'), fullPage: false })
console.log('saved 03 captions')

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
  await p.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,500))
} else {
  await p.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,500))
}
await hoverControls()

// 4) Settings
let setClicked = await p.evaluate(()=>{
  let btn=[...document.querySelectorAll('button[aria-label="Settings"]')][0]
  if(!btn) btn=[...document.querySelectorAll('button')].find(b=> (b.getAttribute('title')||'').toLowerCase().includes('setting'))
  if(btn){ btn.click(); return true }
  return false
})
console.log('setClicked:', setClicked)
await new Promise(r=>setTimeout(r,1000))
await p.screenshot({ path: path.join(OUT, 'anikage-menu-05-settings.png'), fullPage: false })
console.log('saved 05 settings')
await p.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,500))
await hoverControls()

// 5) timeline hover
let tlPos = await p.evaluate(()=>{
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
console.log('saved 07 center play')

// bonus: full page check that wizard is gone
const finalWizard = await p.evaluate(()=> !!document.querySelector('div.fixed.inset-0.z-\\[80\\]'))
console.log('final wizard present?', finalWizard)
await b.close()
console.log('done — all 7 retaken without wizard')
