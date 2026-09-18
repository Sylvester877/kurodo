import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless:'new', executablePath: fs.existsSync(CHROME)?CHROME:undefined, args:['--no-sandbox','--disable-setuid-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width:1440, height:900 })
await p.goto('https://anikage.cc/anime/watch/xsDji4YJsL', { waitUntil:'domcontentloaded', timeout:65000 })
await new Promise(r=>setTimeout(r,10000))
await p.mouse.move(720,750); await new Promise(r=>setTimeout(r,1000))
const dump = await p.evaluate(()=>{
  const mc = document.querySelector('media-container')
  const vp = document.querySelector('video-player')
  const hls = document.querySelector('hlsjs-video')
  const vid = document.querySelector('video')
  // Find the controls container: usually has data-controls or is inside media-container shadow?
  // Vidstack renders inside shadow DOM? Try shadowRoot.
  let shadowHTML = ''
  if (mc && mc.shadowRoot) shadowHTML = mc.shadowRoot.innerHTML.slice(0,5000)
  // Also look for visible control bar inside light DOM near bottom
  const barCands = [...document.querySelectorAll('*')].filter(el=>{
    const r=el.getBoundingClientRect()
    // inside player rect
    const pr = document.querySelector('.player-glass')?.getBoundingClientRect()
    if(!pr) return false
    return r.top >= pr.top && r.bottom <= pr.bottom+60 && r.width>300 && r.height>20 && r.height<120 && el.children.length>2
  }).map(el=>({ tag: el.tagName, cls:(el.className+'').slice(0,120), rect: [Math.round(el.getBoundingClientRect().x),Math.round(el.getBoundingClientRect().y),Math.round(el.getBoundingClientRect().width),Math.round(el.getBoundingClientRect().height)], html: el.outerHTML.slice(0,2500).replace(/\n/g,' ') }))
  // All elements with role/slider
  const sliders = [...document.querySelectorAll('*')].filter(el=>{
    const c=(el.tagName+' '+(el.className||'')).toLowerCase()
    return c.includes('slider')||c.includes('time-slider')||c.includes('progress')|| el.getAttribute('role')==='slider'
  }).map(el=>({ tag:el.tagName, cls:(el.className+'').slice(0,90), html:el.outerHTML.slice(0,1200).replace(/\n/g,' ') }))
  const timeDisplays = [...document.querySelectorAll('*')].filter(el=>{
    const t=(el.textContent||'').trim()
    return /^\d+:\d+/.test(t) && el.getBoundingClientRect().width<160 && el.getBoundingClientRect().height<30
  }).slice(0,10).map(el=>({ text:(el.textContent||'').trim().slice(0,40), tag:el.tagName, cls:(el.className+'').slice(0,90), rect: [Math.round(el.getBoundingClientRect().x),Math.round(el.getBoundingClientRect().y)] }))
  return {
    mcHTML: mc ? mc.outerHTML.slice(0,6000).replace(/\n/g,' ') : 'no-mc',
    mcShadow: shadowHTML.slice(0,4000),
    vpHTML: vp ? vp.outerHTML.slice(0,4000).replace(/\n/g,' ') : 'no-vp',
    hlsHTML: hls ? hls.outerHTML.slice(0,3000).replace(/\n/g,' ') : 'no-hls',
    vidRect: vid ? [Math.round(vid.getBoundingClientRect().x),Math.round(vid.getBoundingClientRect().y),Math.round(vid.getBoundingClientRect().width),Math.round(vid.getBoundingClientRect().height)] : null,
    barCands: barCands.slice(0,8),
    sliders,
    timeDisplays,
    computedBar: (()=>{ const el=document.querySelector('.player-glass'); if(!el) return null; const cs=getComputedStyle(el); return { bg:cs.backgroundColor, bd:cs.borderColor, br:cs.borderRadius, shadow:cs.boxShadow.slice(0,120) } })(),
  }
})
console.log(JSON.stringify(dump,null,2))
await b.close()
