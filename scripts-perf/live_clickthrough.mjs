import puppeteer from 'puppeteer'
import fs from 'node:fs'
const ORIGIN = 'http://127.0.0.1:5173'
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
p.on('console', m => { const t=m.text(); if(t.includes('[schedule]')||t.includes('schedule')||t.includes('jikan')) console.log('  console:', t.slice(0,180)) })
fs.mkdirSync('screenshots', { recursive: true })
async function go(path, name, extraWait=0) {
  console.log(`\n=== ${path} ===`)
  const t0 = Date.now()
  await p.goto(ORIGIN + path, { waitUntil: 'domcontentloaded', timeout: 20000 })
  // measure when grid/header becomes non-skeleton
  const tDom = Date.now()-t0
  console.log(`  domcontentloaded ${tDom}ms`)
  // wait a bit for API to settle, then screenshot
  await new Promise(r=>setTimeout(r, extraWait || 3800))
  const ms = Date.now()-t0
  // request timings from performance entries
  const perf = await p.evaluate(()=> performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/')).map(r=>({u:r.name.replace(/^.*\/api\//,'/api/'), d:Math.round(r.duration), s: r.responseStatus||'?'})))
  if(perf.length) { console.log('  api resources:'); perf.slice(0,12).forEach(r=>console.log(`    ${String(r.d).padStart(4)}ms ${r.s} ${r.u.slice(0,90)}`)) }
  const body = await p.evaluate(()=>document.body.innerText.slice(0,900).replace(/\n/g,' | '))
  console.log('  body:', body.slice(0,380))
  await p.screenshot({ path: `screenshots/${name}.png`, fullPage: false })
  console.log(`  shot screenshots/${name}.png @ ${ms}ms`)
}
await go('/', 'live-01-home', 3200)
await go('/browse?filter=popular', 'live-02-popular', 3800)
await go('/browse?filter=seasonal', 'live-03-seasonal', 3800)
await go('/browse?filter=az&letter=B', 'live-04-azB', 3800)
await go('/browse?filter=az&letter=S', 'live-05-azS', 3800)
await go('/schedule', 'live-06-schedule', 4200)
// click a popular card -> details
await p.goto(ORIGIN + '/browse?filter=popular', { waitUntil: 'domcontentloaded' })
await new Promise(r=>setTimeout(r, 2800))
console.log('\n=== click first popular card -> details ===')
const href = await p.evaluate(()=>{ const a=document.querySelector('a[href^="/anime/"]'); return a ? a.getAttribute('href') : null })
console.log('  href:', href)
if(href){
  const t0=Date.now()
  await p.click('a[href^="/anime/"]')
  await new Promise(r=>setTimeout(r, 3800))
  console.log(`  details nav ${Date.now()-t0}ms`)
  const body2 = await p.evaluate(()=>document.body.innerText.slice(0,700).replace(/\n/g,' | '))
  console.log('  details body:', body2.slice(0,380))
  await p.screenshot({ path: 'screenshots/live-07-details.png', fullPage: false })
  console.log('  shot screenshots/live-07-details.png')
}
await b.close()
