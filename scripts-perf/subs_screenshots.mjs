#!/usr/bin/env node
// Captures subtitle proof screenshots — every anime surface that should show captions.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const BASE = 'http://127.0.0.1:5173'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
async function newPage(w=1440,h=900){
  const p = await b.newPage()
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  return p
}
async function shot(p, name){
  const dst = path.join(OUT, name)
  await p.screenshot({ path: dst, fullPage: false })
  const kb = Math.round(fs.statSync(dst).size/1024)
  console.log(name, kb+'KB')
  return dst
}
async function waitForCards(p, timeout=15000){
  try{
    await p.waitForSelector('[class*="poster-frame"] img, img[src*="/img"]', { timeout })
  }catch{}
  await new Promise(r=>setTimeout(r, 1200))
}

console.log('[subs] capturing…')

// 1) Home — cards should show CC pill now, hero + rails
{
  const p = await newPage()
  await p.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise(r=>setTimeout(r, 2000))
  await waitForCards(p)
  await shot(p, 'subs-home.png')
  // also above-fold focus
  await shot(p, 'subs-home-above.png')
  await p.close()
}

// 2) Browse — anime grid (filters) with CC pills
{
  const p = await newPage()
  await p.goto(BASE + '/browse', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise(r=>setTimeout(r, 2000))
  await waitForCards(p)
  await shot(p, 'subs-browse.png')
  await p.close()
}

// 3) Anime Details — covers + episode list with CC
// Use a well-known anime that is sure to exist even if AniList hiccups
{
  const p = await newPage()
  // Naruto Shippuden 1735 — very likely to resolve via our multi-source fallback
  const urls = ['/anime/1735','/anime/16498','/anime/11061','/anime/1']
  let ok=false
  for(const u of urls){
    try{
      await p.goto(BASE + u, { waitUntil: 'networkidle2', timeout: 30000 })
      await new Promise(r=>setTimeout(r, 2000))
      const h1 = await p.$eval('h1, h2.font-display', el=> (el.textContent||'').slice(0,60)).catch(()=> '')
      if(h1 && !h1.includes('404') && !h1.includes('Not Found')){ console.log('[subs] details:', u, '→', h1.slice(0,40)); ok=true; break }
    }catch(e){ console.log('[subs] details fail', u, e.message.slice(0,80)) }
  }
  await new Promise(r=>setTimeout(r, 1500))
  await shot(p, 'subs-details.png')
  // scroll into episodes
  await p.evaluate(()=> window.scrollTo(0, 900))
  await new Promise(r=>setTimeout(r, 800))
  await shot(p, 'subs-details-episodes.png')
  await p.close()
}

// 4) Search — check that search results cards still show CC
{
  const p = await newPage()
  await p.goto(BASE + '/search?q=Naruto', { waitUntil: 'networkidle2', timeout: 30000 })
  await new Promise(r=>setTimeout(r, 2500))
  await shot(p, 'subs-search-naruto.png')
  await p.close()
}

// 5) Watch page skeleton / loading — player chrome check (if a real episode can be probed)
// We fetch a real stream route server-side first to know what /watch will try to load.
// Don't block the whole run on this — best-effort only.
{
  let watchUrl = '/watch/1735?ep=1'
  try{
    // Probe details to pick first watchable anime
    const r = await pHealth()
    // just hardcode a known watchable title
  }catch{}
  const p = await newPage(1440, 900)
  try{
    await p.goto(BASE + watchUrl, { waitUntil: 'networkidle2', timeout: 30000 })
    await new Promise(r=>setTimeout(r, 4000))
    // need to capture both states: loading + ready
    await shot(p, 'subs-watch-loading.png')
    await new Promise(r=>setTimeout(r, 3000))
    await shot(p, 'subs-watch-player.png')
    // inspect CC button existence
    const hasCC = await p.evaluate(()=>{
      const b = document.body.innerText || ''
      return b.includes('Captions') || document.querySelector('[aria-label=\"Captions\"]') !== null
            || document.querySelector('button[title=\"Captions\"]') !== null
            || !!Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').includes('Captions'))
    }).catch(()=> null)
    console.log('[subs] watch CC control present:', hasCC)
  }catch(e){ console.log('[subs] watch shot failed', e.message.slice(0,120)) }
  await p.close()
}

await b.close()
console.log('[subs] done')

// helpers
async function pHealth(){
  try{ const j = await (await fetch('http://127.0.0.1:5173/api/health')).json(); return j }catch{ return null }
}
