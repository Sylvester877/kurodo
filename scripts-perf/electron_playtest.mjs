/**
 * End-to-end play-test of the REAL Electron app window (via CDP).
 * Drives it like a user: home → search → details → watch → verify playback
 * → switch servers → verify again. Screenshots into screenshots/electron-*.png
 */
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null })

// Pick the main app window (biggest visible page that isn't devtools/splash).
const targets = await browser.targets()
const pages = []
for (const t of targets) {
  if (t.type() !== 'page') continue
  const url = t.url()
  if (url.startsWith('devtools') || url.includes('splash')) continue
  pages.push(t)
}
console.log('targets:', pages.map((p) => p.url().slice(0, 70)))
const page = pages[0] ? await pages[0].page() : await browser.newPage()
console.log('driving:', page.url().slice(0, 80))

// ── 1. Home renders? ──
await page.evaluate(() => { window.scrollTo(0, 0) }).catch(() => {})
const homeHasContent = await page.evaluate(() => document.body.innerText.length > 200)
console.log('home has content:', homeHasContent)
await page.screenshot({ path: path.join(OUT, 'electron-1-home.png') })

// ── 2. Use the app's own search like a user ──
const searched = await page.evaluate(() => {
  const input = document.querySelector('input[type="search"], input[placeholder*="earch" i], input[aria-label*="earch" i]')
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, 'chainsaw man')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})
console.log('typed in search box:', searched)
if (searched) {
  await sleep(3500)
  await page.screenshot({ path: path.join(OUT, 'electron-2-search.png') })
  // click the Reze movie result if present
  const clickedResult = await page.evaluate(() => {
    const card = [...document.querySelectorAll('a, [role=link], .cursor-pointer')]
      .find((el) => /reze/i.test(el.textContent || ''))
    if (card) { card.click(); return true }
    return false
  })
  console.log('clicked Reze result:', clickedResult)
  await sleep(4000)
}

// ── 3. Land on watch page (via details "Watch now" if we're on details) ──
if (!page.url().includes('/watch')) {
  const watchClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, a')]
      .find((b) => /watch now|play now|^watch$/i.test((b.textContent || '').trim()))
    if (btn) { btn.click(); return true }
    return false
  })
  console.log('clicked watch button:', watchClicked)
  await sleep(3500)
}
if (!page.url().includes('/watch')) {
  console.log('falling back to direct watch URL (SPA router)')
  await page.evaluate(() => { window.location.hash = '' }).catch(() => {})
  await page.goto('http://localhost:5173/watch/57555', { waitUntil: 'domcontentloaded' }).catch(() => {})
}
console.log('now at:', page.url().slice(0, 80))

// ── 4. Wait for actual playback ──
let state = null
for (let i = 0; i < 60; i++) {
  state = await page.evaluate(() => {
    const v = document.querySelector('video')
    if (!v) return { found: false }
    return { found: true, rs: v.readyState, t: v.currentTime, w: v.videoWidth, h: v.videoHeight, paused: v.paused }
  })
  if (state.found && state.rs >= 2 && state.t > 0.1) break
  await sleep(1000)
}
console.log('playback:', JSON.stringify(state))
await sleep(3000)
await page.screenshot({ path: path.join(OUT, 'electron-3-playing.png') })

// ── 5. Switch servers like a user (click 2 chips, verify each) ──
const chips = await page.evaluate(() =>
  [...document.querySelectorAll('button')]
    .map((b) => b.textContent.trim().replace(/\s+/g, ' '))
    .filter((t) => /^(yuki|sora|mimi|beep|neko)/i.test(t) && t.length < 40),
)
console.log('chips available:', chips.slice(0, 6))
for (const chip of chips.slice(0, 2)) {
  const name = chip.match(/^(yuki|sora|mimi|beep|neko)/i)[1].toLowerCase()
  await page.evaluate((label) => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim().replace(/\s+/g, ' ').startsWith(label))
    btn?.click()
  }, name.charAt(0).toUpperCase() + name.slice(1))
  let s2 = null
  for (let i = 0; i < 40; i++) {
    s2 = await page.evaluate(() => {
      const v = document.querySelector('video')
      return v ? { found: true, rs: v.readyState, t: v.currentTime } : { found: false }
    })
    if (s2.found && s2.rs >= 2 && s2.t > 0.05) break
    await sleep(1000)
  }
  await sleep(2000)
  await page.screenshot({ path: path.join(OUT, `electron-4-${name}.png`) })
  console.log(`switch → ${name}: ${s2.found ? `rs=${s2.rs} t=${s2.t.toFixed(1)}s` : 'no video'}`)
}

// ── 6. Playback health summary ──
const final = await page.evaluate(() => {
  const v = document.querySelector('video')
  return v ? { rs: v.readyState, t: v.currentTime, w: v.videoWidth, h: v.videoHeight, paused: v.paused, err: v.error?.code || null } : null
})
console.log('FINAL:', JSON.stringify(final))

browser.disconnect()
console.log('done — Electron app left running for the user')
