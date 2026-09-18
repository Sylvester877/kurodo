// Probe reference players (anidap + anikage) for their control-bar structure,
// so Kurodo's PlayerControls can be compared feature/layout-wise.
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

const dumpPlayer = async (label) => {
  const out = await p.evaluate(() => {
    const txt = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)
    const video = document.querySelector('video')
    const v = video ? { w: video.videoWidth, h: video.videoHeight, playing: !video.paused, duration: video.duration || 0 } : null
    // candidate control containers: common classes
    const cands = [...document.querySelectorAll('div')].filter((el) => {
      const c = (el.className + '').toLowerCase()
      return /control|player|bottom|seek|progress|scrub|bar/.test(c) && el.getBoundingClientRect().width > 200 && el.offsetParent
    }).slice(0, 12)
    const structure = cands.map((el) => {
      const r = el.getBoundingClientRect()
      return {
        cls: (el.className + '').toString().slice(0, 90),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        text: txt(el).slice(0, 90),
        btns: [...el.querySelectorAll('button')].length,
      }
    })
    // all buttons visible inside video-adjacent area with aria/title
    const btns = [...document.querySelectorAll('button, [role="button"], a')]
      .filter((el) => el.offsetParent && Math.abs(el.getBoundingClientRect().bottom - (v?.height ? 0 : window.innerHeight)) > 0)
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.bottom > window.innerHeight * 0.55 && r.top < window.innerHeight
      })
      .slice(0, 40)
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { t: txt(el).slice(0, 28), ar: el.getAttribute('aria-label') || '', ti: el.getAttribute('title') || '', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), tag: el.tagName }
      })
    return { v, structure, btns }
  })
  console.log(`\n===== ${label} =====`)
  console.log('video:', JSON.stringify(out.v))
  console.log('containers:')
  for (const c of out.structure) console.log('  ', JSON.stringify(c))
  console.log('bottom-area controls:')
  for (const c of out.btns) console.log('  ', JSON.stringify(c))
  await p.screenshot({ path: `screenshots/ref-player-${label.replace(/\W+/g, '_')}.png` })
}

// ── anidap ─────────────────────────────────────────────────────
try {
  await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await sleep(12000)
  await dumpPlayer('anidap')
} catch (e) { console.log('anidap failed:', e.message.slice(0, 120)) }

// ── anikage: find a watch link from a details page ──────────────
try {
  await p.goto('https://anikage.cc/anime/fullmetal-alchemist-brotherhood', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
  await sleep(8000)
  const href = await p.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find((el) => /watch/i.test(el.getAttribute('href') || ''))
    return a ? a.getAttribute('href') : null
  })
  if (href) {
    const url = new URL(href, 'https://anikage.cc').href
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await sleep(12000)
    await dumpPlayer('anikage')
  } else {
    console.log('anikage: no watch link found on details page')
  }
} catch (e) { console.log('anikage failed:', e.message.slice(0, 120)) }

await b.close()
