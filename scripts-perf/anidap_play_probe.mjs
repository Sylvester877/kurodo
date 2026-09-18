// Drive the real anidap watch page, click play, and capture the chad
// sources request + response + whether a real video element appears.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const p = await b.newPage()
const captures = []
p.on('response', async (r) => {
  const u = r.url()
  if (u.includes('/rest/api/sources') || u.includes('/api/anime/sources')) {
    let body = ''
    try { body = (await r.text()).slice(0, 400) } catch {}
    captures.push({ status: r.status(), url: u.slice(0, 120), body })
  }
})
p.on('console', (m) => { const t = m.text(); if (/error|429|rate|chad|source/i.test(t)) console.log('[c]', t.slice(0, 120)) })
try {
  await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 4000))

  // Click any "play"/episode area, and any server/quality button
  const clicked = await p.evaluate(() => {
    const tryClick = (sel) => { const el = document.querySelector(sel); if (el) { el.click(); return true } return false }
    return tryClick('button') || tryClick('[class*="play"]') || tryClick('.player') || tryClick('video')
  })
  console.log('clicked:', clicked)
  await new Promise((r) => setTimeout(r, 8000))

  const vid = await p.evaluate(() => {
    const v = document.querySelector('video')
    return v ? { src: (v.currentSrc || v.src || '').slice(0, 120), readyState: v.readyState, time: v.currentTime } : null
  })
  console.log('video:', JSON.stringify(vid))
  console.log('captures:')
  for (const c of captures) console.log('  ', c.status, c.url, '->', c.body.slice(0, 200).replace(/\n/g, ' '))
} catch (e) {
  console.log('ERR', e.message.slice(0, 90))
}
await b.close()
