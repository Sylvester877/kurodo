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

async function gotoWatch() {
  await p.goto(`${BASE}/watch/21?ep=1`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  // wait for player to mount + stream to resolve
  await new Promise(r=>setTimeout(r, 9000))
  // hover over player to force controls visible
  await p.mouse.move(720, 750)
  await new Promise(r=>setTimeout(r, 1200))
}

async function clickAria(label) {
  return await p.evaluate((lbl) => {
    const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === lbl)
    if (!btn) return false
    btn.click()
    return true
  }, label)
}

async function closeAnyMenu() {
  await p.keyboard.press('Escape')
  await new Promise(r=>setTimeout(r, 400))
}

await gotoWatch()

// 1) Ghost-chip bar idle — playing
await p.screenshot({ path: path.join(OUT, 'anikage-menu-01-bar-playing.png'), fullPage: false })
console.log('saved 01 bar playing')

// 2) Volume chip hover — the slider expands on hover (group-hover/vol:w-95px)
await p.evaluate(()=> {
  const volBtn = [...document.querySelectorAll('button')].find(b=> b.getAttribute('aria-label')==='Mute' || b.getAttribute('aria-label')==='Unmute')
  if(volBtn) {
    const chip = volBtn.closest('.group\\/vol') || volBtn.parentElement
    // force hover state via mouse
    const r = (chip||volBtn).getBoundingClientRect()
    const ev = new MouseEvent('mouseenter', { bubbles: true })
    if(chip) chip.dispatchEvent(ev)
  }
})
await p.mouse.move(140, 750)
await new Promise(r=>setTimeout(r, 600))
await p.screenshot({ path: path.join(OUT, 'anikage-menu-02-volume-hover.png'), fullPage: false })
console.log('saved 02 volume hover')

// Move away
await p.mouse.move(720, 400)
await new Promise(r=>setTimeout(r, 400))

// 3) Captions menu — hover bar again then click CC
await p.mouse.move(720, 750)
await new Promise(r=>setTimeout(r, 600))
// find CC button robustly — aria-label Captions OR the Captions icon
let ccOk = await clickAria('Captions')
if (!ccOk) {
  ccOk = await p.evaluate(()=> {
    // fallback: find button containing Captions svg (last lucide check)
    const btns=[...document.querySelectorAll('button')]
    const cand = btns.find(b=> b.innerHTML.includes('lucide') && b.closest('[class*=\"bg-black/60\"]'))
    // try clicking every chip button to see which opens a menu
    return false
  })
}
console.log('cc click:', ccOk)
// try alternative: query by title containing Captions
if (!ccOk) {
  const alt = await p.evaluate(()=> {
    const btns=[...document.querySelectorAll('button')]
    const t = btns.find(b=> (b.getAttribute('title')||'').toLowerCase().includes('captions'))
    if(t){ t.click(); return true } return false
  })
  console.log('cc alt title click:', alt)
  ccOk = ccOk || alt
}
await new Promise(r=>setTimeout(r, 1000))
const ccPanel = await p.evaluate(()=> !!document.querySelector('[class*=\"backdrop-blur-2xl\"]') && document.body.innerText.includes('Captions'))
console.log('cc panel visible:', ccPanel)
await p.screenshot({ path: path.join(OUT, 'anikage-menu-03-captions.png'), fullPage: false })
console.log('saved 03 captions')

// Also capture appearance drill-in if present
const appearanceBtn = await p.evaluate(()=> {
  const btn=[...document.querySelectorAll('button')].find(b=> b.textContent.trim()==='Appearance' || b.textContent.includes('Appearance'))
  if(btn){ btn.click(); return true } return false
})
console.log('appearance click:', appearanceBtn)
if (appearanceBtn) {
  await new Promise(r=>setTimeout(r, 800))
  await p.screenshot({ path: path.join(OUT, 'anikage-menu-04-captions-appearance.png'), fullPage: false })
  console.log('saved 04 appearance')
  await closeAnyMenu()
} else {
  await closeAnyMenu()
}

// 4) Settings gear — re-hover then click
await p.mouse.move(720, 750)
await new Promise(r=>setTimeout(r, 600))
let settingsOk = await clickAria('Settings')
if (!settingsOk) {
  settingsOk = await p.evaluate(()=> {
    const btns=[...document.querySelectorAll('button')]
    const t = btns.find(b=> (b.getAttribute('title')||'').toLowerCase().includes('settings'))
    if(t){ t.click(); return true } return false
  })
}
console.log('settings click:', settingsOk)
await new Promise(r=>setTimeout(r, 1000))
const settingsPanel = await p.evaluate(()=> document.body.innerText.includes('Speed') && document.body.innerText.includes('Quality'))
console.log('settings panel visible:', settingsPanel)
await p.screenshot({ path: path.join(OUT, 'anikage-menu-05-settings.png'), fullPage: false })
console.log('saved 05 settings')
await closeAnyMenu()

// 5) Hover timeline — scrubber + time tooltip
await p.mouse.move(720, 750)
await new Promise(r=>setTimeout(r, 400))
const tl = await p.evaluate(()=> {
  const el = document.querySelector('[class*=\"group flex items-center cursor-pointer\"]') || document.querySelector('[class*=\"touch-none\"][class*=\"h-5\"]')
  if(!el) return null
  const r=el.getBoundingClientRect()
  return { x: r.left + r.width*0.42, y: r.top + r.height/2 }
})
console.log('timeline pos:', tl)
if (tl) {
  await p.mouse.move(tl.x, tl.y)
  await new Promise(r=>setTimeout(r, 600))
}
await p.screenshot({ path: path.join(OUT, 'anikage-menu-06-timeline-hover.png'), fullPage: false })
console.log('saved 06 timeline hover')

// 6) Center play glow — pause then show center indicator
await p.evaluate(()=> {
  const v = document.querySelector('video')
  if(v && !v.paused) v.pause()
})
await new Promise(r=>setTimeout(r, 800))
await p.mouse.move(720, 400)
await new Promise(r=>setTimeout(r, 400))
await p.screenshot({ path: path.join(OUT, 'anikage-menu-07-center-play.png'), fullPage: false })
console.log('saved 07 center play')

await b.close()
console.log('done')
