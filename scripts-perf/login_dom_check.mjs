// Quick DOM sanity check for /login — used by the perfection loop.
// Verifies the gate actually renders: heading, client-id input, submit button.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = process.env.LOGIN_BASE || 'http://localhost:5173'

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${BASE}/login?state=relay-check&cid=42167`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  })
  await new Promise((r) => setTimeout(r, 1200))

  const dom = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim() ?? null,
    hasIdInput: !!document.querySelector('input[aria-label="AniList Client ID"]'),
    inputValue: document.querySelector('input[aria-label="AniList Client ID"]')?.value ?? null,
    submitText: [...document.querySelectorAll('button')].some((b) =>
      b.textContent.includes('Sign in with AniList'),
    ),
    discordBtn: [...document.querySelectorAll('button')].some((b) =>
      b.textContent.includes('Join Discord'),
    ),
    relayNote: document.body.textContent.includes('hands your session back'),
    advancedHidden:
      !document.body.textContent.includes('Client secret') ||
      !!document.querySelector('input[type="password"]'),
  }))
  console.log(JSON.stringify(dom, null, 2))

  const ok =
    dom.h1 === 'Kurōdo' &&
    dom.hasIdInput &&
    dom.inputValue === '42167' &&
    dom.submitText &&
    dom.discordBtn &&
    dom.relayNote
  console.log(ok ? 'DOM CHECK: PASS ✓' : 'DOM CHECK: FAIL ✗')
  process.exitCode = ok ? 0 : 1
} finally {
  await browser.close()
}
