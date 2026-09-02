// Round-4 polish sweep:
//  • route change scrolls to top (SPA reset)
//  • stray light backgrounds (dark-theme violations)
//  • stuck skeletons (animate-pulse alive long after load)
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })

// ── 1. route change → scroll reset ──
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 1500))
await p.evaluate(() => window.scrollTo(0, 2000))
await new Promise((r) => setTimeout(r, 300))
const beforeNav = await p.evaluate(() => window.scrollY)
await p.goto('http://localhost:5173/browse', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 1500))
const afterNav = await p.evaluate(() => window.scrollY)
console.log(`1. scroll reset: y before nav=${beforeNav}, after nav=${afterNav} → ${afterNav < 50 ? 'OK' : 'FAIL (stuck scroll)'}`)

// ── 2. stray light backgrounds on all pages ──
const PAGES = [['home', '/'], ['browse', '/browse'], ['watch', '/watch/57555'], ['schedule', '/schedule'], ['seasonal', '/seasonal']]
for (const [name, pathUrl] of PAGES) {
  await p.goto('http://localhost:5173' + pathUrl, { waitUntil: 'networkidle2', timeout: 45000 })
  await new Promise((r) => setTimeout(r, 2500))
  const light = await p.evaluate(() => {
    const out = []
    const lum = (r, g, b2) => 0.2126 * r + 0.7152 * g + 0.0722 * b2
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      const m = cs.backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
      if (!m) continue
      const a = m[4] === undefined ? 1 : +m[4]
      if (a < 0.5) continue
      const L = lum(+m[1], +m[2], +m[3])
      const r = el.getBoundingClientRect()
      if (L > 180 && r.width > 120 && r.height > 80) {
        out.push(`${el.tagName}.${String(el.className).slice(0, 60)} rgb(${m[1]},${m[2]},${m[3]}) [${Math.round(r.width)}x${Math.round(r.height)}]`)
        if (out.length >= 3) break
      }
    }
    return out
  })
  // ── 3. stuck skeletons ──
  const skeletons = await p.evaluate(() => document.querySelectorAll('.animate-pulse, [class*="skeleton"]').length)
  console.log(`2/3. ${name}: light-bg=${light.length} skeleton-el=${skeletons}`)
  light.forEach((s) => console.log('   LIGHT: ' + s))
}
await b.close()
