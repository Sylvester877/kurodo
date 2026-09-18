// Let the real anidap page drive itself, then read the resulting <video>
// element / player config after it decrypts the /api/anime/sources payload.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const p = await b.newPage()
await p.setViewport({ width: 1280, height: 800 })

// Track every fetch to /api/anime/sources or chad,
await p.evaluateOnNewDocument(() => {
  const orig = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const url = String(args[0] || '')
    const res = await orig(...args)
    if (/\/api\/anime\/sources|chad|\/rest\/api\//.test(url)) {
      window.__cap = window.__cap || []
      const t = await res.clone().text()
      window.__cap.push({ url: url.slice(0, 100), status: res.status, body: t.slice(0, 700) })
    }
    return res
  }
})

async function snap(label) {
  const info = await p.evaluate(() => {
    const v = document.querySelector('video')
    const vids = v ? [{ src: (v.currentSrc || v.src || '').slice(0, 120), time: v.currentTime, ready: v.readyState }] : []
    // any iframe embedding an hls/player?
    const ifr = [...document.querySelectorAll('iframe')].map((f) => f.src?.slice(0, 100))
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 250)
    return { vids, ifr, body }
  })
  console.log(`[${label}]`, JSON.stringify(info))
}

try {
  await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'domcontentloaded', timeout: 35000 })
  await new Promise((r) => setTimeout(r, 4000))
  await snap('load')

  // Drive it: click play buttons
  await p.evaluate(() => {
    document.querySelectorAll('button,[class*="server"],[data-type],[class*="quality"]').forEach((el) => {
      const t = (el.textContent || '').toLowerCase()
      if (/play|sub|server|1080|720|fast|1\b/.test(t) || el.hasAttribute('data-type')) { try { el.click() } catch {} }
    })
  }).catch(() => {})
  await new Promise((r) => setTimeout(r, 9000))
  await snap('after-click')

  console.log('captures:')
  const cap = await p.evaluate(() => window.__cap || [])
  for (const c of cap) console.log(' ', c.status, c.url, '->', c.body.slice(0, 130).replace(/\n/g, ' '))
} catch (e) {
  console.log('ERR', e.message.slice(0, 90))
}
await b.close()
