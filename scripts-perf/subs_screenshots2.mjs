#!/usr/bin/env node
// Fresh subtitle proof — rebuild-aware, uses titles that actually have VTT tracks.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu'] })
async function newPage(w=1440,h=900){ const p=await b.newPage(); await p.setViewport({width:w,height:h}); return p }
async function shot(p,name, full=false){
  const dst=path.join(OUT,name)
  await p.screenshot({path:dst, fullPage: full})
  console.log(name, Math.round(fs.statSync(dst).size/1024)+'KB')
}
async function waitForCards(p){ try{ await p.waitForSelector('.poster-frame', {timeout:15000}) }catch{}; await new Promise(r=>setTimeout(r,1200)) }

console.log('[subs2] health', await (await fetch(BASE+'/api/health')).json().then(j=>j.ok+' '+j.version).catch(e=>e.message))

// 1) Home — CC pill on every card
{
  const p=await newPage()
  await p.goto(BASE+'/', {waitUntil:'networkidle2', timeout:30000})
  await waitForCards(p)
  await new Promise(r=>setTimeout(r,1200))
  // highlight one CC pill for proof
  const ccCount = await p.evaluate(()=> document.querySelectorAll('.poster-frame').length + ' cards, ' + document.body.innerHTML.split('>CC<').length + ' CC pills')
  console.log('[home]', ccCount)
  await shot(p,'subs2-home.png')
  await p.close()
}
// 2) Browse — grid CC
{
  const p=await newPage()
  await p.goto(BASE+'/browse', {waitUntil:'networkidle2', timeout:30000})
  await waitForCards(p)
  await shot(p,'subs2-browse.png')
  await p.close()
}
// 3) Details — gallery still CC
{
  const p=await newPage()
  await p.goto(BASE+'/anime/21', {waitUntil:'networkidle2', timeout:30000})
  await new Promise(r=>setTimeout(r,2000))
  await shot(p,'subs2-details.png')
  await p.evaluate(()=> window.scrollTo(0,900))
  await new Promise(r=>setTimeout(r,600))
  await shot(p,'subs2-details-episodes.png')
  await p.close()
}
// 4) Watch — One Piece 21 ep1 has a real English VTT via megavid/anidap-yuki. This proves the auto-enable + CC menu.
{
  const p=await newPage(1440,900)
  p.on('console', m=>{ const t=m.text(); if(t.toLowerCase().includes('subtitle')||t.toLowerCase().includes('captions')||t.toLowerCase().includes('VideoPlayer')) console.log('[console]',t.slice(0,300)) })
  await p.goto(BASE+'/watch/21?ep=1', {waitUntil:'networkidle2', timeout:30000})
  console.log('[watch] navigated, waiting for player…')
  await new Promise(r=>setTimeout(r,5000))
  await shot(p,'subs2-watch-loading.png')
  await new Promise(r=>setTimeout(r,4000))
  // try to hover player to reveal controls
  try{
    const videoHandle = await p.$('video')
    if(videoHandle){ const box=await videoHandle.boundingBox(); if(box) await p.mouse.move(box.x+box.width/2, box.y+box.height/2) }
  }catch{}
  await new Promise(r=>setTimeout(r,1200))
  await shot(p,'subs2-watch-player.png')
  // dump tracks + CC button
  const dump = await p.evaluate(()=>{
    const video=document.querySelector('video')
    const tracks = video ? Array.from(video.querySelectorAll('track')).map(t=>({label:t.getAttribute('label'), lang:t.getAttribute('srclang')||t.getAttribute('srcLang'), kind:t.getAttribute('kind'), src:(t.getAttribute('src')||'').slice(0,120), def:t.hasAttribute('default')})) : []
    const textTracks = video && video.textTracks ? Array.from(video.textTracks).map(tt=>({label:tt.label, lang:tt.language, kind:tt.kind, mode:tt.mode})) : []
    const buttons = Array.from(document.querySelectorAll('button')).map(b=> (b.getAttribute('aria-label')||b.getAttribute('title')||b.textContent||'').slice(0,50).trim()).filter(Boolean)
    const hasCC = buttons.some(x=> x.toLowerCase().includes('caption'))
    const captionsBtn = document.querySelector('[aria-label*=\"Caption\" i], [title*=\"Caption\" i]')
    return { videoSrc: video ? (video.src||video.getAttribute('src')||'').slice(0,140) : null, tracks, textTracks, hasCC, captionsBtn: captionsBtn ? captionsBtn.outerHTML.slice(0,400) : null, buttons: buttons.slice(0,30) }
  })
  console.log('[watch dump]', JSON.stringify(dump,null,2))
  // Try to open captions menu and screenshot it
  try{
    const ccBtn = await p.evaluateHandle(()=> document.querySelector('[aria-label*=\"Caption\" i], [title*=\"Caption\" i]') || Array.from(document.querySelectorAll('button')).find(b=> /caption/i.test(b.textContent||b.getAttribute('aria-label')||'')))
    if(ccBtn){
      const el = ccBtn.asElement()
      if(el){ await el.click(); await new Promise(r=>setTimeout(r,900)); await shot(p,'subs2-watch-captions-open.png') }
    } else {
      console.log('[watch] no CC button found (tracks empty) — dumping fallback')
    }
  }catch(e){ console.log('[watch] open CC failed', e.message.slice(0,120)) }
  await p.close()
}
// 5) Also test Attack on Titan 16498 (5 tracks) as cross-check
{
  const p=await newPage()
  await p.goto(BASE+'/watch/16498?ep=1', {waitUntil:'networkidle2', timeout:30000})
  await new Promise(r=>setTimeout(r,5000))
  try{ const v=await p.$('video'); if(v){ const box=await v.boundingBox(); if(box) await p.mouse.move(box.x+box.width/2, box.y+box.height/2) } }catch{}
  await new Promise(r=>setTimeout(r,1000))
  await shot(p,'subs2-watch-aot.png')
  const dump = await p.evaluate(()=>{
    const video=document.querySelector('video')
    return { tracks: video ? Array.from(video.querySelectorAll('track')).map(t=>t.getAttribute('label')+'|'+t.getAttribute('srclang')).slice(0,8) : [], textTracks: video && video.textTracks ? Array.from(video.textTracks).map(tt=>tt.label+':'+tt.mode).slice(0,8) : [] }
  })
  console.log('[aot dump]', dump)
  await p.close()
}

await b.close()
console.log('[subs2] done')
