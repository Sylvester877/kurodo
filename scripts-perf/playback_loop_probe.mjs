// Capture 30s of playback: console logs, provider-switch toasts, stream/proxy
// requests, and video state changes — to identify the play→refresh loop.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })

const events = []
page.on('console', (m) => {
  const t = m.text()
  if (/hls|error|failed|switch|retry|abort|warn|fetch|stream|provider|megavid|proxy/i.test(t)) {
    events.push({ t: Date.now(), kind: 'console', msg: t.slice(0, 220) })
  }
})
page.on('request', (r) => {
  const u = r.url()
  if (/\/api\/anidap\/sources|\/api\/anidap\/servers|\/proxy\?|\.m3u8|\.ts\b/i.test(u)) {
    events.push({ t: Date.now(), kind: 'req', msg: u.replace(/^http:\/\/localhost:5173/, '').slice(0, 160) })
  }
})

await page.goto('http://localhost:5173/watch/5114?ep=1', { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => /skip setup/i.test(x.textContent || ''))
  if (b) b.click()
}).catch(() => {})

// wait for playing
const deadline = Date.now() + 60_000
let state = 'no-video'
while (Date.now() < deadline) {
  state = await page.evaluate(() => {
    const v = document.querySelector('video')
    if (!v) return 'no-video'
    if (v.readyState >= 2 && !v.paused && v.currentTime > 0) return 'playing'
    if (v.readyState >= 2) return 'loaded-paused'
    return 'loading'
  }).catch(() => 'probe-error')
  if (state === 'playing') break
  await new Promise((r) => setTimeout(r, 1000))
}
console.log('initial state:', state)
events.push({ t: Date.now(), kind: 'mark', msg: 'PLAYING — starting 35s observation' })

// observe 35s
const t0 = Date.now()
while (Date.now() - t0 < 35_000) {
  await new Promise((r) => setTimeout(r, 2500))
  const st = await page.evaluate(() => {
    const v = document.querySelector('video')
    if (!v) return 'no-video'
    return `ready=${v.readyState} paused=${v.paused} t=${v.currentTime.toFixed(1)} dur=${(v.duration || 0).toFixed(0)}`
  }).catch((e) => 'err ' + e.message)
  events.push({ t: Date.now(), kind: 'video', msg: st })
}

// summarize
const start = events.find((e) => e.kind === 'mark')?.t || 0
let lastT = 0
for (const e of events) {
  if (e.t < start) continue
  const dt = ((e.t - start) / 1000).toFixed(1)
  const dup = e.msg === events.find((x) => x !== e && x.msg === e.msg && x.kind === e.kind) ? '' : ''
  console.log(`[${dt}s] ${e.kind}: ${e.msg}${dup}`)
}
await browser.close()
