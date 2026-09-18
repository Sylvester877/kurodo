// Force the real anidap player to decrypt by spoofing the (429ing)
// episodes call with a valid episode list, then let the site call
// /api/anime/sources (which works) and decrypt it. Capture the player's
// actual media URL via video element + media request hook.
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

const media = []
p.on('request', (r) => {
  const u = r.url()
  if (/\.m3u8|\.mp4|\.webm|kryntal|megaplay|akirax|streamzone|mewstream|\.ts(\?|$)/i.test(u)) media.push({ type: r.resourceType(), url: u.slice(0, 170) })
})

await p.evaluateOnNewDocument(() => {
  const orig = window.fetch.bind(window)
  window.fetch = async (...args) => {
    const url = String(args[0] || '')
    // Spoof a valid episodes response so the app proceeds past episode load.
    if (/chad\.anidap\.lol\/rest\/api\/episodes/.test(url)) {
      const eps = [
        { episode: 1, title: 'Episode 1', dub: true, sub: true, fillers: false },
        { episode: 2, title: 'Episode 2', dub: true, sub: true, fillers: false },
      ]
      // capture the decrypted sources for later reading
      return new Response(JSON.stringify(eps), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (/\/api\/anime\/sources/.test(url)) {
      window.__srcFetch = url.slice(0, 120)
      const res = await orig(...args)
      const t = await res.clone().text()
      window.__srcRaw = t
      return res
    }
    return orig(...args)
  }
})

try {
  await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'domcontentloaded', timeout: 35000 })
  await new Promise((r) => setTimeout(r, 5000))
  await p.evaluate(() => {
    document.querySelectorAll('button,[class*="server"],[data-type]').forEach((el) => {
      const t = (el.textContent || '').toLowerCase()
      if (/sub|server|play|1080|720|fast/.test(t) || el.hasAttribute('data-type')) { try { el.click() } catch {} }
    })
  }).catch(() => {})
  await new Promise((r) => setTimeout(r, 14000))
  const srcFetch = await p.evaluate(() => window.__srcFetch || null)
  const srcRaw = await p.evaluate(() => window.__srcRaw || null)
  const vid = await p.evaluate(() => {
    const v = document.querySelector('video')
    return v ? { src: (v.currentSrc || v.src || '').slice(0, 140), time: v.currentTime, ready: v.readyState } : null
  })
  console.log('srcFetch:', srcFetch)
  console.log('srcRaw:', srcRaw ? srcRaw.slice(0, 140) : null)
  console.log('video:', JSON.stringify(vid))
  console.log('=== media requests ===')
  for (const m of media) console.log(' ', m.type, m.url)
} catch (e) {
  console.log('ERR', e.message.slice(0, 90))
}
await b.close()
