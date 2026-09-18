// Watch for the actual media/stream URLs the anidap player requests after
// it decrypts the sources payload. This reveals the real CDN + URL format
// so we can construct playable streams without fighting the cipher.
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
  if (/\.m3u8|\.mp4|\.webm|kryntal|megaplay|akirax|streamzone|mewstream|hidrive|\.ts(\?|$)|videoplayback|gogo-video|cdn/i.test(u)) {
    media.push({ type: r.resourceType(), url: u.slice(0, 160) })
  }
})
p.on('response', (r) => {
  const u = r.url()
  if (/\/api\/anime\/sources|chad|\/rest\/api\//.test(u)) {
    r.text().then((t) => console.log('[api]', r.status(), u.slice(0, 90), '->', t.slice(0, 120).replace(/\n/g, ' '))).catch(() => {})
  }
})

try {
  await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'domcontentloaded', timeout: 35000 })
  await new Promise((r) => setTimeout(r, 4000))
  await p.evaluate(() => {
    document.querySelectorAll('button,[class*="server"],[data-type]').forEach((el) => {
      const t = (el.textContent || '').toLowerCase()
      if (/sub|server|play|1080|720|fast/.test(t) || el.hasAttribute('data-type')) { try { el.click() } catch {} }
    })
  }).catch(() => {})
  await new Promise((r) => setTimeout(r, 12000))
  console.log('=== media requests ===')
  for (const m of media) console.log(' ', m.type, m.url)
  if (media.length === 0) console.log('  (none — episodes 429 blocked the player)')
} catch (e) {
  console.log('ERR', e.message.slice(0, 90))
}
await b.close()
