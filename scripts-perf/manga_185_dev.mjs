import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\Program Files\Google\Chrome\Application\chrome.exe'
const b = await puppeteer.launch({ headless: false, executablePath: fs.existsSync(CHROME) ? CHROME : undefined, args: ['--no-sandbox','--disable-gpu','--start-maximized'] })
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const logs=[]
p.on('console', m=> logs.push(`[${m.type()}] ${m.text().slice(0,500)}`))
p.on('pageerror', e=> logs.push(`[pageerror] ${e.message.slice(0,800)}\n${e.stack?.slice(0,800)}`))
const url='http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
console.log('goto',url)
await p.goto(url,{waitUntil:'networkidle2',timeout:20000}).catch(e=>console.log('goto err',e.message))
await new Promise(r=>setTimeout(r,8000))
console.log('logs tail',logs.slice(-30).join('\n---\n'))
const html=await p.content()
console.log('has 185?',html.includes('185')||html.includes('Maximum update'))
console.log('body', (await p.evaluate(()=>document.body.innerText.slice(0,3000))).slice(0,2000))
await p.screenshot({path:'repo/screenshots/manga-dev-185.png',fullPage:true})
console.log('saved')
await new Promise(r=>setTimeout(r,5000))
await b.close()
