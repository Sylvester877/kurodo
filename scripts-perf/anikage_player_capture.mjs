import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const TARGET = process.env.ANIKAGE_URL || 'https://anikage.cc/anime/watch/xsDji4YJsL'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
console.log('goto', TARGET)
await p.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 65000 })
await sleep(9000)

// Try to reveal controls (hover player)
await p.mouse.move(720, 750)
await sleep(1200)
await p.mouse.move(730, 755)
await sleep(700)

await p.screenshot({ path: path.join(OUT, 'anikage-ref-live-1.png'), fullPage: false })
console.log('shot anikage-ref-live-1.png (hovered controls)')

// Dump DOM structure of the player bar
const dump = await p.evaluate(() => {
  const trim = (s) => (s||'').trim().replace(/\s+/g,' ').slice(0,120)
  const video = document.querySelector('video')
  const vInfo = video ? { w: video.videoWidth, h: video.videoHeight, paused: video.paused, dur: video.duration, rect: (()=>{const r=video.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})() } : null

  // Find any player container - likely biggest div near video
  const allDivs = [...document.querySelectorAll('div')]
  const cands = allDivs.filter(el=>{
    const r=el.getBoundingClientRect()
    return r.width>400 && r.height>40 && r.width < 1450 && el.offsetParent
  }).slice(0,8).map(el=>{
    const r=el.getBoundingClientRect()
    const c=(el.className+'').toString().slice(0,120)
    // computed styles for bar area
    const cs = getComputedStyle(el)
    return { cls: c, x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height),
             bg: cs.backgroundColor.slice(0,60), bgImg: cs.backgroundImage.slice(0,90),
             backdrop: cs.backdropFilter, borderRadius: cs.borderRadius,
             html: el.outerHTML.slice(0,900).replace(/\n/g,' ') }
  })

  // Buttons in bottom band of viewport (the bar)
  const btns = [...document.querySelectorAll('button, [role=\"button\"]')]
    .filter(el=>el.offsetParent)
    .filter(el=>{
      const r=el.getBoundingClientRect()
      return r.bottom > window.innerHeight*0.5 && r.width>8 && r.width<80 && r.height<60
    })
    .slice(0,50)
    .map(el=>{
      const r=el.getBoundingClientRect()
      const innerSVG = el.querySelector('svg')
      const hasSVG = !!innerSVG
      const title = el.getAttribute('title')||el.getAttribute('aria-label')||trim(el.textContent)
      return { x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), title, hasSVG, cls:(el.className+'').toString().slice(0,90), html: el.outerHTML.slice(0,500).replace(/\n/g,' ') }
    })

  // timeline / progress clues
  const bars = [...document.querySelectorAll('div, input[type=\"range\"]')].filter(el=>{
    const r=el.getBoundingClientRect()
    const c=(el.className+'').toLowerCase()
    return /progress|seek|slider|scrub|timeline|track|range/.test(c) && r.width>200
  }).slice(0,10).map(el=>{
    const r=el.getBoundingClientRect()
    const cs=getComputedStyle(el)
    return { cls:(el.className+'').toString().slice(0,90), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), bg:cs.backgroundColor.slice(0,40), hPx: Math.round(r.height), html: el.outerHTML.slice(0,700).replace(/\n/g,' ') }
  })

  // menus/popovers visible
  const menus = [...document.querySelectorAll('[role=\"menu\"], [role=\"listbox\"], [data-radix-popper], div')].filter(el=>{
    const r=el.getBoundingClientRect()
    const c=(el.className+'').toLowerCase()
    return /menu|panel|popover|dropdown|listbox|settings|quality|captions/.test(c) && el.offsetParent && r.width>100 && r.width<400
  }).slice(0,6).map(el=>{
    const r=el.getBoundingClientRect()
    return { cls:(el.className+'').toString().slice(0,90), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), html: el.outerHTML.slice(0,700).replace(/\n/g,' ') }
  })

  return { vInfo, cands, btns, bars, menus, bodyBg: getComputedStyle(document.body).backgroundColor }
})
console.log(JSON.stringify(dump, null, 2))

// Click the gear to expose settings menu
try {
  const clicked = await p.evaluate(() => {
    const pick = [...document.querySelectorAll('button')].find(b=>{
      const a=(b.getAttribute('aria-label')||b.getAttribute('title')||b.textContent||'').toLowerCase()
      return /settings|quality|cog|gear/.test(a) && b.offsetParent
    })
    if (pick) { pick.click(); return pick.getAttribute('aria-label')||pick.getAttribute('title')||'gear' }
    // fallback: last button cluster on bottom bar
    const all=[...document.querySelectorAll('button')].filter(b=>b.offsetParent && b.getBoundingClientRect().bottom>window.innerHeight*0.6)
    const last=all[all.length-4]
    if(last){ last.click(); return 'fallback-btn' }
    return null
  })
  console.log('gear click:', clicked)
  await sleep(1100)
  await p.screenshot({ path: path.join(OUT, 'anikage-ref-live-2-settings.png'), fullPage: false })
  console.log('shot anikage-ref-live-2-settings.png')
} catch(e){ console.log('settings click fail', e.message.slice(0,80)) }

// Also click CC button
try {
  const clicked = await p.evaluate(() => {
    const pick=[...document.querySelectorAll('button')].find(b=>{
      const a=(b.getAttribute('aria-label')||b.getAttribute('title')||b.textContent||'').toLowerCase()
      return /caption|cc|subtitle/.test(a) && b.offsetParent
    })
    if(pick){ pick.click(); return true }
    return false
  })
  console.log('cc click', clicked)
  await sleep(800)
  await p.screenshot({ path: path.join(OUT, 'anikage-ref-live-3-cc.png'), fullPage: false })
  console.log('shot anikage-ref-live-3-cc.png')
} catch(e){ console.log('cc fail', e.message.slice(0,80)) }

await b.close()
console.log('done anikage capture')
