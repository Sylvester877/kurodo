// Full dissection of anikage's watch-page player so Kurodo can match it.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await p.goto('https://anikage.cc/anime/watch/3FMkbr7zt8', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(15000)

const out = await p.evaluate(() => {
  const txt = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const video = document.querySelector('video')
  const rect = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
  }
  // The player container: climb from the video to a sized ancestor
  let host = video ? video.parentElement : null
  for (let i = 0; i < 6 && host; i++) {
    const r = host.getBoundingClientRect()
    if (r.width > 400 && r.height > 300) break
    host = host.parentElement
  }
  const hostRect = rect(host)
  const videoRect = rect(video)

  // every interactive element inside the host area + its classes/icons
  const controls = host ? [...host.querySelectorAll('button, input, [role="slider"], [role="menuitem"], [role="menu"]')]
    .filter((el) => el.offsetParent)
    .map((el) => {
      const r = el.getBoundingClientRect()
      const cls = (el.className + '').toString().slice(0, 110)
      const aria = el.getAttribute('aria-label') || ''
      return {
        tag: el.tagName.toLowerCase(),
        cls,
        text: txt(el).slice(0, 30),
        aria: aria.slice(0, 40),
        type: el.getAttribute('type') || '',
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      }
    })
    : []
  // top-level text nodes visible near video (top-left overlays)
  return {
    url: location.href,
    hasVideo: !!video,
    videoRect,
    hostRect,
    hostBg: host ? getComputedStyle(host).background.slice(0, 80) : '',
    controls,
  }
})
console.log('PAGE:', out.url)
console.log('video:', JSON.stringify(out.videoRect), 'host:', JSON.stringify(out.hostRect))
console.log('host bg:', out.hostBg)
console.log('CONTROLS:')
for (const c of out.controls) console.log(' ', JSON.stringify(c))
await p.screenshot({ path: 'screenshots/anikage-player-full.png' })
// also capture the player area only
if (out.videoRect) {
  const clip = { x: Math.max(0, out.hostRect.x - 8), y: Math.max(0, out.hostRect.y - 8), width: out.hostRect.w + 16, height: out.hostRect.h + 80, scale: 1 }
  await p.screenshot({ path: 'screenshots/anikage-player-zoom.png', clip })
}
await b.close()
