// Stability soak: replicate the navigation pattern that preceded the silent
// server deaths (ERR_CONNECTION_REFUSED). Hammers crash-adjacent routes for
// ~2 minutes, checks server health between rounds, and reports survival.
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const BASE = 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const routes = [
  '/',
  '/browse?filter=top-rated',
  '/browse?filter=popular',
  '/browse?filter=seasonal',
  '/browse?filter=upcoming',
  '/browse?filter=az&letter=B',
  '/browse?filter=az&letter=A',
  '/browse?filter=genre&genreId=1',
  '/anime/60636',
  '/anime/57555',
  '/anime/21',
  '/search?q=naruto',
  '/manga',
  '/schedule',
  '/seasons',
  '/browse?filter=genre&genreId=2',
  '/anime/5114',
  '/browse?filter=popular',
  '/',
]

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
page.setDefaultTimeout(20000)

let ok = 0
let failed = 0
const failures = []
const start = Date.now()
let rounds = 0
while (Date.now() - start < 150_000) {
  rounds++
  for (const r of routes) {
    if (Date.now() - start > 150_000) break
    try {
      await page.goto(BASE + r, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await sleep(1400)
      ok++
    } catch (e) {
      failed++
      failures.push(r + ' → ' + String(e.message || e).slice(0, 60))
      if (failed >= 3) break
    }
  }
  // Health check between rounds
  try {
    const h = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(4000) })
    if (!h.ok) { failed++; failures.push('health ' + h.status) }
  } catch (e) {
    failed++
    failures.push('health → ' + String(e.message || e).slice(0, 60))
  }
  if (failed >= 3) break
}
await browser.close()

const alive = await new Promise((resolve) => {
  fetch(BASE + '/api/health', { signal: AbortSignal.timeout(4000) })
    .then((h) => resolve(h.ok))
    .catch(() => resolve(false))
})
let electronAlive = '?'
try {
  electronAlive = execSync('tasklist 2>/dev/null | grep -ci electron.exe', { shell: 'bash', encoding: 'utf8' }).trim()
} catch { /* ignore */ }

console.log(JSON.stringify({
  durationSec: Math.round((Date.now() - start) / 1000),
  rounds,
  navigationsOk: ok,
  navigationsFailed: failed,
  failures: failures.slice(0, 6),
  serverSurvived: alive,
  electronProcesses: electronAlive,
}, null, 2))
