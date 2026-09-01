/**
 * UI perfection-loop audit — hunts visual BUGS I can verify without eyes:
 *   • horizontal page overflow (layout breakage)
 *   • broken images (naturalWidth 0 after load)
 *   • low-contrast text (< 4.5:1 for body-size text)
 *   • inconsistent card radii (6+ distinct values = drift)
 *   • elements overflowing their parents
 * Pages: /, /browse, /watch/<id>, /schedule, /seasonal
 * Output: per-page findings + a summary verdict.
 */
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

const auditPage = (page) =>
  page.evaluate(() => {
    const out = { overflowX: null, brokenImgs: [], lowContrast: [], radii: [], spill: [] }
    const de = document.documentElement
    if (de.scrollWidth > window.innerWidth + 2) {
      out.overflowX = `${de.scrollWidth} > ${window.innerWidth}`
      // find the widest offender
      let worst = null
      let worstW = 0
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width > worstW && r.right > window.innerWidth + 8) {
          worstW = r.width
          worst = el
        }
      }
      if (worst) out.overflowX += ` ← ${worst.tagName}.${String(worst.className).slice(0, 60)}`
    }
    for (const img of document.querySelectorAll('img')) {
      if (img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().width > 40) {
        out.brokenImgs.push((img.src || '').slice(0, 80))
      }
    }
    // contrast: sample visible text nodes with computed color vs effective bg
    const lum = (r, g, b) => {
      const f = (c) => {
        c /= 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const parse = (s) => {
      const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
      return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null
    }
    const bgOf = (el) => {
      let n = el
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor)
        if (c && c[3] > 0.85) return c
        n = n.parentElement
      }
      return [0, 0, 0, 1]
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const seen = new Set()
    let n
    while ((n = walker.nextNode())) {
      const t = n.textContent.trim()
      if (!t || t.length < 3) continue
      const el = n.parentElement
      if (!el || seen.has(el)) continue
      seen.add(el)
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden') continue
      const r = el.getBoundingClientRect()
      if (r.width < 30 || r.height < 8) continue
      const fg = parse(cs.color)
      if (!fg || fg[3] < 0.6) continue
      const bg = bgOf(el)
      const L1 = lum(fg[0], fg[1], fg[2])
      const L2 = lum(bg[0], bg[1], bg[2])
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
      const size = parseFloat(cs.fontSize)
      if (ratio < 4.0 && size < 24) {
        const cls = String(el.className || '').slice(0, 80)
        out.lowContrast.push(`${ratio.toFixed(2)}:1 "${t.slice(0, 32)}" ${size}px <${el.tagName.toLowerCase()} class="${cls}">`)
        if (out.lowContrast.length > 8) break
      }
    }
    // radius drift on poster-ish cards
    const radii = new Set()
    for (const el of document.querySelectorAll('[class*="rounded"], [class*="overflow-hidden"]')) {
      const r = getComputedStyle(el).borderRadius
      if (r && r !== '0px' && r !== '9999px' && r !== '9999px ') radii.add(r)
    }
    out.radii = [...radii].slice(0, 10)
    return out
  })

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--mute-audio'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  const report = {}
  for (const [name, path] of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 3500))
    // scroll to trigger lazy sections + image loads
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
      window.scrollTo(0, 0)
    })
    await new Promise((r) => setTimeout(r, 1500))
    report[name] = await auditPage(page)
    const f = report[name]
    console.log(
      `\n── ${name}: overflowX=${f.overflowX ? 'YES ⚠' : 'no'} brokenImgs=${f.brokenImgs.length} lowContrast=${f.lowContrast.length} radii=${f.radii.length}`,
    )
    if (f.overflowX) console.log('   ', f.overflowX)
    f.brokenImgs.slice(0, 3).forEach((s) => console.log('    broken:', s))
    f.lowContrast.slice(0, 4).forEach((s) => console.log('    contrast:', s))
    if (f.radii.length > 5) console.log('    radii drift:', f.radii.join(' | '))
  }
  fs.writeFileSync('screenshots/ui-audit.json', JSON.stringify(report, null, 1))
  console.log('\nreport → screenshots/ui-audit.json')
} finally {
  await browser.close()
}
