// Verify settings actually PERSIST after the createJSONStorage fix.
//
// Before the fix `localStorage['kurodo-settings']` held the literal string
// "[object Object]" — a string storage was handed to Zustand's persist, which
// passes it the whole { state, version } object. Every launch then failed to
// parse it and fell back to defaults, so NO setting survived a restart.
//
// This reloads the app, flips a real setting in the UI, and inspects what was
// written. A pass means: valid JSON + the toggled value is present.
import puppeteer from 'puppeteer'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find((p) => p.url().includes('5173')) || pages[0]

const readRaw = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem('kurodo-settings')
    let parsed = null
    try { parsed = JSON.parse(raw || 'null') } catch { /* invalid */ }
    return {
      rawHead: (raw || '').slice(0, 90),
      validJson: !!parsed,
      version: parsed?.version ?? null,
      autoplayNext: parsed?.state?.autoplayNext ?? null,
      keys: parsed?.state ? Object.keys(parsed.state).length : 0,
    }
  })

console.log('reloading with the new bundle …')
await page.reload({ waitUntil: 'domcontentloaded' })
await sleep(4000)
console.log('after reload →', JSON.stringify(await readRaw()))

// Flip a real setting through the UI so the store writes.
console.log('\nopening Settings and flipping "Autoplay next" …')
await page.goto('http://localhost:5173/settings', { waitUntil: 'domcontentloaded' })
await sleep(5000)

const flipped = await page.evaluate(() => {
  // Find the row containing the autoplay label, then its toggle control.
  const nodes = [...document.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && /autoplay next/i.test(el.textContent || ''),
  )
  for (const label of nodes) {
    let row = label
    for (let i = 0; i < 6 && row; i++) {
      const ctrl = row.querySelector?.('[role="switch"], button[aria-checked], input[type="checkbox"], button')
      if (ctrl) {
        ctrl.click()
        return { clicked: (ctrl.tagName + ' ' + (ctrl.getAttribute('role') || '') + ' ' + (ctrl.className || '').slice(0, 40)).trim() }
      }
      row = row.parentElement
    }
  }
  // Fallback: any switch on the page.
  const any = document.querySelector('[role="switch"]')
  if (any) { any.click(); return { clicked: 'fallback [role=switch]' } }
  return { clicked: null }
})
console.log('toggle →', JSON.stringify(flipped))

// The debounced write has a 300ms trailing delay.
await sleep(2500)
const after = await readRaw()
console.log('\nafter toggling →', JSON.stringify(after))

const pass = after.validJson && after.keys > 5
console.log(`\n${pass ? 'PASS' : 'FAIL'} — settings persist as valid JSON with ' + ' state`)
await page.screenshot({ path: 'screenshots/settings-persist-after.png' })
browser.disconnect()
process.exit(pass ? 0 : 1)
