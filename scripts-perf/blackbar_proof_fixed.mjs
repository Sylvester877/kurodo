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
await p.evaluateOnNewDocument(()=>{ try{ localStorage.setItem('kurodo-setup-done','1'); localStorage.setItem('kurodo-setup-shown','1')}catch{} })

async function gotoWatch() {
  await p.goto(`${BASE}/watch/21?ep=1`, { waitUntil:'domcontentloaded', timeout:30000 })
  await new Promise(r=>setTimeout(r,800))
  await p.evaluate(()=>{ try{ localStorage.setItem('kurodo-setup-done','1'); localStorage.setItem('kurodo-setup-shown','1')}catch{} })
  // dismiss wizard if still there
  await p.evaluate(()=>{ const b=[...document.querySelectorAll('button')].find(x=> x.textContent.includes('Skip setup')); if(b) b.click() })
  await new Promise(r=>setTimeout(r,600))
  // wait for video
  let t=0; while(t<35){ const has=await p.evaluate(()=> !!document.querySelector('video')); if(has) break; await new Promise(r=>setTimeout(r,1000)); t++ }
  // wait for playing-ish
  await new Promise(r=>setTimeout(r,7000))
  // seek to ~5s to get a stable non-black frame (Denji-like close-up sooner)
  await p.evaluate(()=>{ const v=document.querySelector('video'); if(v){ try{ v.currentTime=5 }catch{} } })
  await new Promise(r=>setTimeout(r,1500))
}
await gotoWatch()

async function probeDiagnostics(){
  return await p.evaluate(()=>{
    const v=document.querySelector('video')
    const wrap=document.querySelector('.group.relative.w-full.overflow-hidden')
    const wrapStyle = wrap ? getComputedStyle(wrap) : null
    return {
      videoWidth: v? v.videoWidth : null,
      videoHeight: v? v.videoHeight : null,
      intrinsicAspect: v && v.videoWidth && v.videoHeight ? (v.videoWidth/v.videoHeight).toFixed(4) : null,
      wrapAspect: wrapStyle ? wrapStyle.aspectRatio : null,
      videoObjectFit: v? getComputedStyle(v).objectFit : null,
      videoTransform: v? getComputedStyle(v).transform : null,
      videoW: v? getComputedStyle(v).width : null,
      videoH: v? getComputedStyle(v).height : null,
      readyState: v? v.readyState : null,
      currentTime: v? v.currentTime.toFixed(2) : null,
    }
  })
}
let diag = await probeDiagnostics()
console.log('windowed diag:', JSON.stringify(diag,null,2))
// hover to show controls then screenshot windowed
await p.mouse.move(720, 820)
await new Promise(r=>setTimeout(r,900))
await p.screenshot({ path: path.join(OUT, 'blackbar-fixed-windowed.png'), fullPage:false })
console.log('saved blackbar-fixed-windowed.png')
// also check crop state via React-ish: look for width/height overrides on video
let cropProbe = await p.evaluate(()=>{
  const v=document.querySelector('video')
  if(!v) return null
  return { style: v.getAttribute('style'), class: v.className.slice(0,120) }
})
console.log('video style windowed:', cropProbe)

// fullscreen — trigger via button click (Fullscreen aria-label)
const fsClicked = await p.evaluate(()=>{
  const btn=[...document.querySelectorAll('button')].find(b=> (b.getAttribute('aria-label')||'').toLowerCase().includes('fullscreen'))
  if(btn){ btn.click(); return true } return false
})
console.log('fullscreen click:', fsClicked)
await new Promise(r=>setTimeout(r,1800))
let diagFs = await probeDiagnostics()
console.log('fullscreen diag:', JSON.stringify(diagFs,null,2))
await p.mouse.move(720, 820)
await new Promise(r=>setTimeout(r,700))
await p.screenshot({ path: path.join(OUT, 'blackbar-fixed-fullscreen.png'), fullPage:false })
console.log('saved blackbar-fixed-fullscreen.png')
await p.keyboard.press('Escape')
await new Promise(r=>setTimeout(r,600))

// second probe after escaping fullscreen to ensure crop persists windowed
await p.mouse.move(720, 820)
await new Promise(r=>setTimeout(r,700))
await p.screenshot({ path: path.join(OUT, 'blackbar-fixed-windowed2.png'), fullPage:false })
console.log('saved blackbar-fixed-windowed2.png')
let finalDiag = await probeDiagnostics()
console.log('final windowed diag:', JSON.stringify(finalDiag,null,2))

await b.close()
console.log('done')
