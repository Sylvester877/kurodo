import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'screenshots')
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms))
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME)?CHROME:undefined, args:['--no-sandbox','--disable-gpu'] })
async function shot(name, setup, w=1440,h=900, fullPage=false) {
  const p = await b.newPage()
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  await setup(p)
  await p.screenshot({ path: path.join(OUT, name), fullPage })
  console.log(`saved ${name}`)
  await p.close()
}
// 1 — /manga browse + hero
await shot('sweep-full-manga-browse-full.png', async p=>{
  await p.goto('http://127.0.0.1:5173/manga',{waitUntil:'domcontentloaded',timeout:30000}); await sleep(5000)
},1440,900,true)
await shot('sweep-full-manga-browse-above.png', async p=>{
  await p.goto('http://127.0.0.1:5173/manga',{waitUntil:'domcontentloaded',timeout:30000}); await sleep(5000)
})
// find a manga link from the grid
let firstMangaHref = null
{
  const p = await b.newPage()
  await p.setViewport({ width:1440, height:900, deviceScaleFactor:1 })
  await p.goto('http://127.0.0.1:5173/manga',{waitUntil:'domcontentloaded',timeout:30000}); await sleep(4000)
  firstMangaHref = await p.evaluate(()=> {
    const a = document.querySelector('a[href^=\"/manga/\"]')
    return a ? a.getAttribute('href') : null
  })
  console.log('firstMangaHref', firstMangaHref)
  await p.close()
}
if (firstMangaHref) {
  await shot('sweep-full-manga-details.png', async p=>{
    await p.goto(`http://127.0.0.1:5173${firstMangaHref}`,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(5000)
  },1440,900,true)
  // click first chapter -> reader strip
  await shot('sweep-full-manga-reader-strip.png', async p=>{
    await p.goto(`http://127.0.0.1:5173${firstMangaHref}`,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(4000)
    // find first chapter link
    const href = await p.evaluate(()=>{
      const a = document.querySelector('a[href^=\"/manga/read/\"]')
      return a ? a.getAttribute('href') : null
    })
    console.log('reader href', href)
    if (href) { await p.goto(`http://127.0.0.1:5173${href}`,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(7000) }
  })
  // reader page mode — toggle to page
  await shot('sweep-full-manga-reader-page.png', async p=>{
    await p.goto(`http://127.0.0.1:5173${firstMangaHref}`,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(4000)
    const href = await p.evaluate(()=> document.querySelector('a[href^=\"/manga/read/\"]')?.getAttribute('href') || null)
    if (href) {
      await p.goto(`http://127.0.0.1:5173${href}`,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(6000)
      // toggle readMode to page via localStorage then reload
      await p.evaluate(()=>{ try{ const k='kurodo-reader'; const o=JSON.parse(localStorage.getItem(k)||'{}'); o.state = o.state||{}; o.state.readMode='page'; localStorage.setItem(k, JSON.stringify(o)); }catch{} })
      await p.reload({waitUntil:'domcontentloaded'}); await sleep(6000)
    }
  })
  // reader drawer + chapter list
  await shot('sweep-full-manga-reader-drawer.png', async p=>{
    await p.goto(`http://127.0.0.1:5173${firstMangaHref}`,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(4000)
    const href = await p.evaluate(()=> document.querySelector('a[href^=\"/manga/read/\"]')?.getAttribute('href') || null)
    if (href) {
      await p.goto(`http://127.0.0.1:5173${href}`,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(6000)
      // move mouse to edge to reveal pill, then click chapters pill
      await p.mouse.move(720, 20); await sleep(800)
      const clicked = await p.evaluate(()=>{
        const btns = [...document.querySelectorAll('button')]
        const b = btns.find(x=> x.textContent && x.textContent.includes('Ch.'))
        if (b) { b.click(); return true } return false
      })
      console.log('clicked chapters pill', clicked)
      await sleep(1500)
    }
  })
}
// mobile
await shot('sweep-full-manga-mobile-browse.png', async p=>{
  await p.goto('http://127.0.0.1:5173/manga',{waitUntil:'domcontentloaded',timeout:30000}); await sleep(4000)
},390,844)
await shot('sweep-full-manga-mobile-reader.png', async p=>{
  const q = await b.newPage()
  await q.setViewport({width:1440,height:900,deviceScaleFactor:1})
  await q.goto('http://127.0.0.1:5173/manga',{waitUntil:'domcontentloaded',timeout:30000}); await sleep(4000)
  const href = await q.evaluate(()=> document.querySelector('a[href^=\"/manga/read/\"]')?.getAttribute('href') || null)
  await q.close()
  console.log('mobile reader href', href)
  if (href) { await p.goto(`http://127.0.0.1:5173${href}`,{waitUntil:'domcontentloaded',timeout:30000}); await sleep(7000) }
},390,844)

// Also grab the critique 9-shot for comparison
import { spawnSync } from 'node:child_process'
spawnSync('node', ['scripts-perf/manga_critique_loop.mjs'], { cwd: ROOT, stdio: 'inherit' })

console.log('done')
await b.close()
