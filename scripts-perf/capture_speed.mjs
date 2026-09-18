import puppeteer from 'puppeteer'
import fs from 'node:fs'
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const out = 'screenshots'
fs.mkdirSync(out, { recursive: true })
async function shot(path, name, waitMs=3500) {
  console.log('→', path)
  const t0 = Date.now()
  await p.goto(`http://127.0.0.1:5173${path}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await new Promise(r=>setTimeout(r, waitMs))
  const ms = Date.now()-t0
  console.log(`  ${path} dom+${waitMs}ms = ${ms}ms total`)
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: false })
  console.log('  saved', `${out}/${name}.png`)
  const txt = await p.evaluate(()=>document.body.innerText.slice(0,1200))
  console.log('  text head:', txt.slice(0,400).replace(/\n/g,' | '))
}
await shot('/schedule', 'schedule-speedfix', 4500)
await shot('/browse?filter=popular', 'browse-popular-speedfix', 4500)
await shot('/browse?filter=seasonal', 'browse-seasonal-speedfix', 4500)
await shot('/browse?filter=az&letter=B', 'browse-azB-speedfix', 4500)
await shot('/browse?filter=az&letter=S', 'browse-azS-speedfix', 4500)
await b.close()
