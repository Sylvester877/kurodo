import puppeteer from 'puppeteer'
import fs from 'node:fs'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({ headless:'new', executablePath: fs.existsSync(CHROME)?CHROME:undefined, args:['--no-sandbox','--disable-setuid-sandbox'] })
const p = await b.newPage()
await p.setViewport({ width:1440, height:900 })
await p.goto('https://anikage.cc/anime/watch/xsDji4YJsL', { waitUntil:'domcontentloaded', timeout:65000 })
await new Promise(r=>setTimeout(r,10000))
await p.mouse.move(720,740); await new Promise(r=>setTimeout(r,800))
const html = await p.evaluate(()=>{
  // Find the flex row that holds the chips
  const row = document.querySelector('.pointer-events-auto.flex.w-full') || [...document.querySelectorAll('div')].find(d=>d.className.includes('pointer-events-auto')&&d.className.includes('flex'))
  if(!row) return 'no-row'
  // clone outerHTML but prettify by inserting newlines around chip divs
  let s = row.outerHTML
  // Also get computed styles of key parts
  const chips = [...row.querySelectorAll('.vjs-ctrl-chip')]
  const chipInfo = chips.map(c=>{
    const cs=getComputedStyle(c)
    return { cls:c.className, bg:cs.backgroundColor, pad:cs.padding, br:cs.borderRadius, html:c.outerHTML.slice(0,1200).replace(/\n/g,' ') }
  })
  const slider = document.querySelector('media-time-slider')
  const sliderHTML = slider ? slider.outerHTML.slice(0,4000).replace(/\n/g,' ') : 'no-slider'
  const vol = document.querySelector('media-volume-slider')
  const volHTML = vol ? vol.outerHTML.slice(0,2000).replace(/\n/g,' ') : 'no-vol'
  const timeGroup = document.querySelector('media-time-group')
  const timeHTML = timeGroup ? timeGroup.outerHTML.slice(0,1500).replace(/\n/g,' ') : 'no-timeGroup'
  return { rowHTML: s.slice(0,8000).replace(/\n/g,' '), chipInfo, sliderHTML, volHTML, timeHTML }
})
console.log(JSON.stringify(html,null,2))
await b.close()
