// Hook the real anidap watch page's fetch so we capture the DECRYPTED
// sources after the site's own JS decrypts the /api/anime/sources payload.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const p = await b.newPage()

// Patch fetch on every page to log and return-through; also monkey-patch
// JSON.parse and capture any decrypted-looking data the app builds.
await p.evaluateOnNewDocument(() => {
  const origFetch = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const url = String(args[0] || '')
    if (url.includes('/api/anime/sources') || url.includes('chad') || url.includes('/rest/api')) {
      const res = await origFetch(...args)
      const text = await res.clone().text()
      window.__cap = window.__cap || []
      window.__cap.push({ url: url.slice(0, 90), status: res.status, body: text.slice(0, 600) })
      return res
    }
    return origFetch(...args)
  }
})

try {
  await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'domcontentloaded', timeout: 35000 })
  await new Promise((r) => setTimeout(r, 5000))
  // Also try to trigger the player
  await p.evaluate(() => {
    document.querySelectorAll('button,[class*="server"],[data-type]').forEach((el) => {
      const t = (el.textContent || '').toLowerCase()
      if (/sub|server|play|1080|fast/.test(t) || el.hasAttribute('data-type')) { try { el.click() } catch {} }
    })
  }).catch(() => {})
  await new Promise((r) => setTimeout(r, 8000))
  const cap = await p.evaluate(() => window.__cap || [])
  console.log('captured requests:', cap.length)
  for (const c of cap) {
    console.log(' ', c.status, c.url)
    console.log('   body:', c.body.slice(0, 220).replace(/\n/g, ' '))
  }
  // Debug: dump window globals that might hold decrypted sources
  const keys = await p.evaluate(() => {
    const out = []
    for (const k of Object.keys(window)) {
      if (/source|stream|video|decrypt|play/i.test(k)) out.push(k)
    }
    return out
  })
  console.log('window keys:', JSON.stringify(keys))
} catch (e) {
  console.log('ERR', e.message.slice(0, 90))
}
await b.close()
