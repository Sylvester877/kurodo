// Probe: do interactive elements show a visible focus ring when tabbed to?
// Tabs N times, checking each focused element for a nonzero outline/box-shadow.
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
const arg = process.argv[2] || ''
await p.goto('http://localhost:5173/' + arg.replace(/^\/+/, ''), {
  waitUntil: 'networkidle2',
  timeout: 45000,
})
await new Promise((r) => setTimeout(r, 2000))

const results = []
for (let i = 0; i < 15; i++) {
  await p.keyboard.press('Tab')
  await new Promise((r) => setTimeout(r, 450)) // let focus transitions (300ms) finish
  const info = await p.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return null
    const cs = getComputedStyle(el)
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
    const shadow = (cs.boxShadow || '') !== 'none'
    const text = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)
    return {
      tag: el.tagName,
      text,
      outline,
      shadow,
      shadowVal: cs.boxShadow.slice(0, 60),
      outlineVal: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
    }
  })
  if (info) results.push(info)
}
const invisible = results.filter((r) => !r.outline && !r.shadow)
console.log(`tabbed ${results.length} elements — focus-visible failures: ${invisible.length}`)
results.slice(0, 8).forEach((r) =>
  console.log(`  ${r.tag} "${r.text}" outline=${r.outline} shadow=${r.shadow} (${r.shadowVal})`),
)
if (invisible.length) {
  console.log('── no-ring elements:')
  invisible.slice(0, 8).forEach((r) => console.log(`  ✗ ${r.tag} "${r.text}"`))
}
await b.close()
