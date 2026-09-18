import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const b = await puppeteer.launch({ headless: 'new', executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const logs=[]
p.on('console', m=>{
  const t=(m.args().map(a=>a._remoteObject?.value ?? '')).join(' ').slice(0,500)
  if(m.type()==='error' || t.toLowerCase().includes('error')) logs.push(`[${m.type()}] ${m.text().slice(0,400)}`)
})
p.on('pageerror', e=> logs.push(`[pageerror] ${e.message.slice(0,500)}`))
const url='http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
console.log('goto',url)
try{ await p.goto(url,{waitUntil:'domcontentloaded',timeout:15000}) }catch(e){ console.log('goto err',e.message)}
await new Promise(r=>setTimeout(r,6000))
const html=await p.content()
const has185=html.includes('Minified React error #185')||html.includes('Maximum update')
const body=await p.evaluate(()=>document.body.innerText.slice(0,2000))
console.log('has185?',has185)
console.log('body snippet:',body.slice(0,1000))
console.log('logs:',logs.slice(0,20).join('\n'))
await p.screenshot({path:'repo/screenshots/manga-185-probe.png',fullPage:true})
console.log('screenshot saved')
await b.close()
