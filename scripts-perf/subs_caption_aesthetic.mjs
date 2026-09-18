import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const BASE = 'http://127.0.0.1:5173'
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
})

async function watchWithCue(labelPrefix, watchUrl) {
  const p = await b.newPage()
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  await p.goto(watchUrl, { waitUntil: 'domcontentloaded', timeout: 55000 })
  const t0 = Date.now()
  while (Date.now() - t0 < 55000) {
    const has = await p.evaluate(() => !!document.querySelector('button[aria-label=\"Captions\"], button[title=\"Captions\"]'))
    if (has) break
    await sleep(700)
  }
  console.log(labelPrefix, 'CC ready after', Date.now() - t0)
  await sleep(900)
  // Ensure video is playing and seek to mid-dialogue; retry a few cues until text appears
  await p.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(()=>{}) } })
  await sleep(1200)
  const cueTimes = [40, 95, 130, 200, 65, 15, 180]
  let best = null
  for (const sec of cueTimes) {
    await p.evaluate((s) => { const v = document.querySelector('video'); if (v) { v.currentTime = s } }, sec)
    await sleep(1600)
    const hasCue = await p.evaluate(() => {
      const v = document.querySelector('video')
      if (!v) return { has: false, text: '' }
      const tt = v.textTracks?.[0]
      const cues = tt?.activeCues
      const text = cues && cues.length ? Array.from(cues).map(c => c.text).join(' ') : ''
      // also check rendered cue box in shadow DOM fallback
      const cueBox = document.querySelector('video::cue') ? 'has-cue-el' : ''
      return { has: !!(cues && cues.length), text, lang: tt?.label || '', mode: tt?.mode || '', cueBox }
    })
    console.log(labelPrefix, 'seek', sec, 'cue?', hasCue.has, 'text:', hasCue.text.slice(0, 80))
    const rendered = await p.evaluate(() => {
      // best effort: get computed ::cue visibility by checking activeCues presence
      const v = document.querySelector('video')
      const tt = v?.textTracks?.[0]
      return tt?.activeCues?.length || 0
    })
    if (hasCue.has && hasCue.text.trim()) { best = sec; break }
    if (rendered > 0 && !best) best = sec
  }
  if (best != null) console.log(labelPrefix, 'best cue at', best)
  // One shot with controls hidden (hover off video) so caption is the hero
  await p.mouse.move(10, 10)
  await sleep(400)
  await p.screenshot({ path: path.join(OUT, `${labelPrefix}-caption-aesthetic.png`), fullPage: false })
  console.log('shot', `${labelPrefix}-caption-aesthetic.png`)
  // Also open CC menu + appearance panel to show settings
  await p.evaluate(() => {
    const btn = document.querySelector('button[aria-label=\"Captions\"]') || document.querySelector('button[title=\"Captions\"]')
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await sleep(700)
  await p.screenshot({ path: path.join(OUT, `${labelPrefix}-caption-ccopen.png`), fullPage: false })
  console.log('shot', `${labelPrefix}-caption-ccopen.png`)
  // Drill into Appearance
  await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Appearance' || b.textContent?.includes('Appearance'))
    btn?.click()
  })
  await sleep(600)
  await p.screenshot({ path: path.join(OUT, `${labelPrefix}-caption-appearance.png`), fullPage: false })
  console.log('shot', `${labelPrefix}-caption-appearance.png`)
  await p.close()
}

await watchWithCue('subs-aesthetic-onepiece', `${BASE}/watch/21?ep=1`)
await watchWithCue('subs-aesthetic-bleach', `${BASE}/watch/269?ep=1`)

await b.close()
console.log('done aesthetic')
