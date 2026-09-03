// Interaction test: rail radio click → URL param set → results refresh → click again → reset.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHOTS = path.join(ROOT, 'screenshots')
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 900 })

// Pre-dismiss the first-run SetupWizard (blocks the page with a black blur
// on fresh profiles).
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('kurodo-setup-done', '1')
  localStorage.setItem('kurodo-setup-shown', '1')
})

await p.goto('http://localhost:5173/search?q=naruto', { waitUntil: 'networkidle2', timeout: 45000 })
await new Promise((r) => setTimeout(r, 3500))

const before = await p.evaluate(() => ({
  url: location.search,
  cards: document.querySelectorAll('a[href^="/anime/"]').length,
}))

// Click "Winter" in the Season rail
const clicked = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('aside button')]
  const winter = btns.find((b) => b.textContent.trim() === 'Winter')
  if (!winter) return false
  winter.click()
  return true
})
await new Promise((r) => setTimeout(r, 3500))

const after = await p.evaluate(() => ({
  url: location.search,
  cards: document.querySelectorAll('a[href^="/anime/"]').length,
}))

console.log('BEFORE:', JSON.stringify(before))
console.log('clicked Winter:', clicked)
console.log('AFTER :', JSON.stringify(after))
const seasonApplied = after.url.includes('season=winter')

// Screenshot with the filter active (radio dot visible)
await p.screenshot({ path: path.join(SHOTS, 'search-redesign-filtered.png') })

// Toggle off
await p.evaluate(() => {
  const btns = [...document.querySelectorAll('aside button')]
  const winter = btns.find((b) => b.textContent.trim() === 'Winter')
  winter?.click()
})
await new Promise((r) => setTimeout(r, 1500))
const reset = await p.evaluate(() => location.search)
console.log('RESET :', reset)
console.log(seasonApplied && !reset.includes('season=winter') ? 'PASS: season filter works + resets' : 'FAIL')

await b.close()
