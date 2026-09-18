import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const chromePath = fs.existsSync(CHROME) ? CHROME : undefined

async function capture(url, outName, opts = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--window-size=1440,900'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  page.setDefaultNavigationTimeout(30000)
  console.log(`[capture] goto ${url}`)
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 6000))
    // Try to dismiss cookie banners
    try {
      const btns = await page.$$('button')
      for (const b of btns) {
        const t = await page.evaluate(el => el.innerText?.slice(0,60), b)
        if (/accept|agree|ok|got it/i.test(t||'')) { try { await b.click(); await new Promise(r=>setTimeout(r,800)); } catch {} }
      }
    } catch {}
    // Scroll a bit to trigger lazy loads
    try { await page.evaluate(()=> window.scrollTo(0, 400)); await new Promise(r=>setTimeout(r,800)); await page.evaluate(()=> window.scrollTo(0,0)); await new Promise(r=>setTimeout(r,800)); } catch {}
    const full = path.join(OUT, outName)
    await page.screenshot({ path: full, fullPage: true })
    console.log(`[capture] saved ${full} (${Math.round(fs.statSync(full).size/1024)}KB)`)

    // Also capture above-the-fold viewport only
    const viewName = outName.replace('.png','-viewport.png')
    await page.screenshot({ path: path.join(OUT, viewName), fullPage: false })
    console.log(`[capture] saved viewport ${viewName}`)

    // Dump a tiny DOM summary
    const summary = await page.evaluate(()=>{
      const els = [...document.querySelectorAll('header, nav, [class*="reader"], [class*="chapter"], [class*="progress"], [class*="toolbar"], [class*="control"]')].slice(0,20).map(e=> ({
        tag: e.tagName.toLowerCase(),
        cls: (e.className||'').toString().slice(0,120),
        text: (e.innerText||'').slice(0,120).replace(/\s+/g,' ')
      }))
      return { title: document.title.slice(0,120), url: location.href, els, bodyText: document.body.innerText.slice(0,800).replace(/\s+/g,' ') }
    })
    console.log(`[capture] ${outName} title=${summary.title}`)
    console.log(`[capture] body preview: ${summary.bodyText.slice(0,300)}`)
    console.log(JSON.stringify(summary.els, null, 2))
  } catch(e) {
    console.log(`[capture] FAIL ${url}: ${e.message}`)
  } finally {
    await browser.close()
  }
}

console.log('[capture] starting refs...')
await capture('https://mangafire.to/title/jjrxn-bleach/chapter/5849566', 'ref-mangafire-bleach-ch5849566.png')
await capture('https://atsu.moe/read/VRSVH/v0OZrew0#rs=p:3', 'ref-atsu-VRSVH-v0OZrew0.png')

// Also capture our current reader for comparison (requires local server)
console.log('[capture] capturing local reader for baseline...')
try {
  const browser2 = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args: ['--no-sandbox','--disable-gpu'] })
  const p2 = await browser2.newPage()
  await p2.setViewport({ width: 1440, height: 900 })
  // Need a known manga reader URL - try atsu Bleach one
  const localUrl = 'http://127.0.0.1:5173/manga/read/yaCvs?manga=sVC2A&source=atsu&malId=13'
  console.log(`[capture] goto local ${localUrl}`)
  await p2.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await new Promise(r=>setTimeout(r,7000))
  await p2.screenshot({ path: path.join(OUT, 'baseline-local-reader.png'), fullPage: true })
  console.log('[capture] saved baseline-local-reader.png')
  await p2.screenshot({ path: path.join(OUT, 'baseline-local-reader-viewport.png'), fullPage: false })
  console.log('[capture] saved viewport')
  await browser2.close()
} catch(e) {
  console.log('[capture] local baseline failed:', e.message)
}
console.log('[capture] done')
