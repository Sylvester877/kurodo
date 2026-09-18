#!/usr/bin/env node
// Hit backend directly to see subtitle shape for a watched title + inspect Watch DOM
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BASE = 'http://127.0.0.1:5173'

console.log('[probe] backend health + watch subtitle pipeline')

async function getJson(u){
  const r = await fetch(u, { headers: { 'Accept': 'application/json' } })
  console.log('GET', u, '→', r.status, r.headers.get('content-type')?.slice(0,40))
  const t = await r.text()
  try{ const j=JSON.parse(t); console.log(JSON.stringify(j).slice(0, 2000)); return j }catch{ console.log(t.slice(0,1000)); return null }
}

// 1) Health
await getJson(BASE + '/api/health')
// 2) Anime details to know an anilistId
const det = await getJson(BASE + '/api/anilist/1735').catch(()=>null)
// Try anidap servers for Naruto ep 1 (mal 1735 -> anilist id mapping is done server-side)
// Brute: call our backend's anidap servers endpoint shape — whatever exists
for(const u of ['/api/anidap/servers?malId=1735&ep=1&type=sub','/api/anidap/servers?anilistId=1735&ep=1&type=sub']){
  await getJson(BASE + u).catch(()=>{})
}

// 3) Open watch page and dump DOM facts for subtitle/CC
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless:'new', executablePath: fs.existsSync(CHROME)?CHROME:undefined, args:['--no-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width:1440, height:900 })
p.on('console', m => {
  const t = m.text()
  if(t.toLowerCase().includes('subtitle') || t.toLowerCase().includes('caption') || t.toLowerCase().includes('track')) console.log('[console]', t.slice(0,400))
})
p.on('response', async r => {
  const u = r.url()
  if(u.includes('/proxy') && (u.includes('vtt') || u.includes('subtitle'))) {
    console.log('[net proxy subtitle]', r.status(), u.slice(0,140))
  }
  if(u.includes('/api/anidap')){
    try{ const ct = r.headers()['content-type']||''; if(ct.includes('json')){ const j = await r.json().catch(()=>null)
      if(j){ const s = JSON.stringify(j); console.log('[anidap]', u.slice(0,120), '→', s.slice(0,800)) }
    } }catch{}
  }
})
await p.goto(BASE + '/watch/1735?ep=1', { waitUntil:'networkidle2', timeout:30000 })
await new Promise(r=>setTimeout(r,6000))
const dump = await p.evaluate(()=>{
  const video = document.querySelector('video')
  const tracks = video ? Array.from(video.querySelectorAll('track')).map(t=> ({ kind:t.getAttribute('kind'), srcLang:t.getAttribute('srclang')||t.getAttribute('srcLang'), label:t.getAttribute('label'), src:(t.getAttribute('src')||'').slice(0,90), def:t.hasAttribute('default') })) : []
  const textTracks = video && video.textTracks ? Array.from(video.textTracks).map((tt)=> ({ label:tt.label, kind:tt.kind, lang:tt.language, mode:tt.mode })) : []
  const playerHtml = document.querySelector('[class*=\"group relative\"] video') ? 'video present' : 'no video'
  const buttons = Array.from(document.querySelectorAll('button')).map(b=> (b.getAttribute('aria-label')||b.title||b.textContent||'').slice(0,40).trim()).filter(Boolean).slice(0,40)
  const hasCaptionsBtn = buttons.some(x=> x.toLowerCase().includes('caption'))
  const body = document.body.innerText.slice(0,600)
  return { videoSrc: video? (video.getAttribute('src')||video.src||'').slice(0,120):null, poster: video?.getAttribute('poster')?.slice(0,90)||null, tracks, textTracks, playerHtml, buttons, hasCaptionsBtn, bodyHead: body.slice(0,400) }
})
console.log('[dom]', JSON.stringify(dump, null, 2))
await b.close()
