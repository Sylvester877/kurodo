// Layout sanity: poster overlaps banner bottom; title sits beside it; meta/genres below.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 })
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('kurodo-setup-done', '1')
  localStorage.setItem('kurodo-setup-shown', '1')
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await p.goto('http://localhost:5173/browse', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(7000)
const target = await p.evaluate(() => {
  const cards = [...document.querySelectorAll('a[href^="/anime/"]')]
  const el = cards.find((c) => {
    const r = c.getBoundingClientRect()
    return r.width > 120 && r.top > 100 && r.bottom < innerHeight * 0.85
  })
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
})
await p.mouse.move(target.x, target.y)
await sleep(1400)

const geo = await p.evaluate(() => {
  const card = [...document.querySelectorAll('div.rounded-2xl.bg-zinc-900\\/\\[0\\.97\\]')]
    .find((c) => c.querySelector('h4'))
  if (!card) return null
  const banner = card.querySelector('div.relative.h-\\[110px\\]')
  const posterWrap = banner?.querySelector('div.border-2') // poster has border-2 border-white/15
  const h4 = card.querySelector('h4')
  const br = banner.getBoundingClientRect()
  const pr = posterWrap.getBoundingClientRect()
  const tr = h4.getBoundingClientRect()
  return {
    bannerBottom: Math.round(br.bottom),
    posterTop: Math.round(pr.top),
    posterBottom: Math.round(pr.bottom),
    posterOverlapsBanner: pr.top < br.bottom && pr.bottom > br.bottom,
    posterLeft: Math.round(pr.left),
    titleLeft: Math.round(tr.left),
    titleRightOfPoster: tr.left > pr.right - 8,
    titleTop: Math.round(tr.top),
  }
})
console.log(JSON.stringify(geo, null, 1))
await b.close()
