import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const exe = fs.existsSync(CHROME) ? CHROME : undefined
const browser = await puppeteer.launch({ headless: 'new', executablePath: exe, args: ['--no-sandbox','--disable-gpu'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800 })
const logs=[]
page.on('console', m=>{
  const txt = m.text()
  if(m.type()==='error' || txt.includes('Error') || txt.includes('185')) logs.push(`[console:${m.type()}] ${txt.slice(0,1500)}`)
})
page.on('pageerror', e=> logs.push(`[pageerror] ${e.message.slice(0,1500)}\n${(e.stack||'').slice(0,1500)}`))
const url='http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
console.log('goto',url)
try{ await page.goto(url,{waitUntil:'domcontentloaded', timeout: 20000}) }catch(e){ console.log('goto err',e.message) }
await new Promise(r=>setTimeout(r,8000))
const html = await page.content()
console.log('html len',html.length)
console.log('has crash?', html.includes('Something went wrong')||html.includes('Unable to load')||html.includes('Minified React error'))
console.log('snippet', html.slice(html.indexOf('<body'), html.indexOf('<body')+8000).slice(0,7000))
for(const l of logs) console.log(l)
await page.screenshot({path:'repo/screenshots/manga-185-repro.png', fullPage:false})
console.log('screenshot saved')
await browser.close()
