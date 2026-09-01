/**
 * /login screenshot harness — the "perfection loop" visual checker.
 *
 * Captures every state of the new black/white login gate into screenshots/:
 *   1. gate-default    — cold visit, no params (advanced visible: no client id)
 *   2. gate-from-app   — Electron flow: ?state=relay-xyz&cid=12345 (prefilled, advanced hidden)
 *   3. gate-invalid    — validation error (client id "abc")
 *   4. gate-busy       — redirecting spinner state
 *   5. gate-mobile     — 390×844 viewport (phone)
 *   6. gate-advanced   — advanced panel open with the secret field
 *
 * Usage:  node scripts-perf/login_shots.mjs
 * Output: screenshots/login-<name>.png
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.LOGIN_BASE || 'http://localhost:5173'
// Puppeteer's bundled-Chrome cache is absent on this machine — use system Chrome.
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2 }
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2 }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function shot(browser, name, url, viewport, actions) {
  const page = await browser.newPage()
  await page.setViewport(viewport)
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 })
  await sleep(1600) // entrance animation
  if (actions) {
    await actions(page)
    await sleep(900)
  }
  const p = path.join(OUT, `login-${name}.png`)
  await page.screenshot({ path: p })
  console.log(`  ✓ ${name} → ${p}`)
  await page.close()
}

const clickButtonWithText = (page, needle) =>
  page.evaluate((n) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(n))
    if (btn) btn.click()
    return !!btn
  }, needle)

const invalidSubmit = (page) =>
  page.evaluate(() => {
    const input = document.querySelector('input[type="text"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'abc')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }).then(() => clickButtonWithText(page, 'Sign in with AniList'))

const busyShot = (page) =>
  page.evaluate(() => {
    // Simulate the redirecting state without actually navigating.
    const btn = document.querySelector('button[type="submit"]')
    btn.setAttribute('disabled', '')
    btn.querySelector('span:last-child')?.replaceChildren(document.createTextNode('Redirecting…'))
    const svg = btn.querySelector('svg')
    if (svg) svg.style.animation = 'spin 1s linear infinite'
  })

const openAdvanced = (page) => clickButtonWithText(page, 'Advanced')

async function main() {
  const t0 = Date.now()
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-gpu'],
  })
  try {
    console.log(`/login shots → ${OUT}`)
    await shot(browser, 'gate-default', `${BASE}/login`, DESKTOP)
    await shot(browser, 'gate-from-app', `${BASE}/login?state=relay-demo-abc123&cid=42167`, DESKTOP)
    await shot(browser, 'gate-invalid', `${BASE}/login?cid=42167`, DESKTOP, invalidSubmit)
    await shot(browser, 'gate-busy', `${BASE}/login?state=relay-demo-abc123&cid=42167`, DESKTOP, busyShot)
    await shot(browser, 'gate-mobile', `${BASE}/login?state=relay-demo-abc123&cid=42167`, MOBILE)
    await shot(browser, 'gate-advanced', `${BASE}/login`, DESKTOP, openAdvanced)
  } finally {
    await browser.close()
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
