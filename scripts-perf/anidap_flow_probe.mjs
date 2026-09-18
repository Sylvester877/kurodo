// Capture every API request (method + status + URL) the real anidap watch
// page makes, including chad sources/auth, to see exactly what's needed.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const p = await b.newPage()
const reqs = []
p.on('response', (r) => {
  const u = r.url()
  if (/anidap|chad|graphql|rest\/api/.test(u) && !/assets|\.js|\.css|\.svg|\.png/.test(u)) {
    reqs.push({ status: r.status(), url: u.slice(0, 140) })
  }
})
p.on('console', (m) => { const t = m.text(); if (/401|403|429|error|rate|auth|chad|source/i.test(t)) console.log('[c]', t.slice(0, 110)) })
try {
  await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'networkidle2', timeout: 35000 })
  await new Promise((r) => setTimeout(r, 4000))
  // Try to trigger sources by clicking server buttons
  await p.evaluate(() => {
    document.querySelectorAll('button, [class*="server"], [data-type]').forEach((el) => {
      const t = (el.textContent || '').toLowerCase()
      if (/sub|server|play|1080|fast/.test(t) || el.hasAttribute('data-type')) { try { el.click() } catch {} }
    })
  }).catch(() => {})
  await new Promise((r) => setTimeout(r, 6000))
  console.log('=== API requests ===')
  for (const r of reqs) console.log(' ', r.status, r.url)
} catch (e) {
  console.log('ERR', e.message.slice(0, 90))
}
await b.close()
