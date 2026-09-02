// Mobile (375px) UI audit — overflow, broken images, tap-target sizes, tiny text.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://localhost:5173'
const PAGES = [
  ['home', '/'],
  ['browse', '/browse'],
  ['watch-reze', '/watch/57555'],
  ['schedule', '/schedule'],
  ['seasonal', '/seasonal'],
]

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

for (const [name, pathUrl] of PAGES) {
  try {
    await page.goto(`${BASE}${pathUrl}`, { waitUntil: 'networkidle2', timeout: 45000 })
    await new Promise((r) => setTimeout(r, 2500))
    const res = await page.evaluate(() => {
      const out = { overflowX: null, brokenImgs: 0, smallTap: [], tinyText: [] }
      const de = document.documentElement
      if (de.scrollWidth > window.innerWidth + 2) {
        out.overflowX = `${de.scrollWidth} > ${window.innerWidth}`
        let worst = null
        let worstW = 0
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.width > worstW && r.right > window.innerWidth + 8) {
            worstW = r.width
            worst = el
          }
        }
        if (worst) out.overflowX += ` ← ${worst.tagName}.${String(worst.className).slice(0, 70)}`
      }
      for (const img of document.querySelectorAll('img')) {
        if (img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().width > 40) out.brokenImgs++
      }
      // tap targets: interactive elements smaller than 40x40 (generous WCAG 44 is harsh for dense UIs)
      for (const el of document.querySelectorAll('button, a')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.width < 36 || r.height < 36) {
          const t = (el.textContent || '').trim().slice(0, 24)
          if (out.smallTap.length < 4) out.smallTap.push(`${el.tagName} [${Math.round(r.width)}x${Math.round(r.height)}] "${t}"`)
        }
      }
      // tiny text below 10px
      for (const el of document.querySelectorAll('body *')) {
        if (el.children.length) continue
        const t = (el.textContent || '').trim()
        if (!t) continue
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 10 && out.tinyText.length < 4) out.tinyText.push(`${fs}px "${t.slice(0, 30)}"`)
      }
      return out
    })
    console.log(`── ${name}: overflowX=${res.overflowX ? 'YES ' + res.overflowX : 'no'} brokenImgs=${res.brokenImgs} smallTap=${res.smallTap.length} tinyText=${res.tinyText.length}`)
    if (res.overflowX) console.log('   ' + res.overflowX)
    res.smallTap.forEach((s) => console.log('   tap: ' + s))
    res.tinyText.forEach((s) => console.log('   tiny: ' + s))
  } catch (e) {
    console.log(`✗ ${name}: ${String(e.message).slice(0, 80)}`)
  }
}
await browser.close()
