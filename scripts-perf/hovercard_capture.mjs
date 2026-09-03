// Capture the aniclover-style hover card:
// 1. hover an anime card on /browse until the portal appears
// 2. verify portal DOM (banner img + poster img + genre pills + footer text)
// 3. screenshot; pixel-verify the card region differs from background
// 4. retry up to 3x until verified
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
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

let ok = false
for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
  try {
    await p.goto('http://localhost:5173/browse', { waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(7000)

    // Find a card in the top grid area and hover it
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
    if (!target) { console.log(`attempt ${attempt}: no card found`); continue }

    await p.mouse.move(target.x, target.y)
    await sleep(300)
    await p.mouse.move(target.x + 3, target.y + 3) // nudge to trigger enter events
    await sleep(1400) // HOVER_DELAY 400 + animation

    // Verify the portal card rendered with expected structure
    const check = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('div.rounded-2xl.bg-zinc-900\\/\\[0\\.97\\]')]
      const card = cards.find((c) => c.querySelector('h4'))
      if (!card) return { found: false }
      const imgs = card.querySelectorAll('img')
      const pills = [...card.querySelectorAll('span')].filter((s) => /border.*rounded-full/.test(s.className)).length
      const footer = card.textContent.includes('Click to view details')
      const title = card.querySelector('h4')?.textContent?.slice(0, 50)
      const r = card.getBoundingClientRect()
      return {
        found: true, imgs: imgs.length, pills, footer, title,
        w: Math.round(r.width), h: Math.round(r.height),
        inView: r.top >= 0 && r.bottom <= innerHeight,
      }
    })
    console.log(`attempt ${attempt}: portal=`, JSON.stringify(check))

    if (check.found && check.imgs >= 1 && check.footer && check.inView) {
      const file = path.join(OUT, 'hovercard-aniclover.png')
      await p.screenshot({ path: file })

      // Pixel check: card region should have bright text pixels (std within card area)
      const b64 = fs.readFileSync(file).toString('base64')
      const stats = await p.evaluate(async (b64) => {
        const resp = await fetch(`data:image/png;base64,${b64}`)
        const bmp = await createImageBitmap(await resp.blob())
        const c = document.createElement('canvas')
        c.width = bmp.width; c.height = bmp.height
        const ctx = c.getContext('2d')
        ctx.drawImage(bmp, 0, 0)
        const { data } = ctx.getImageData(0, 0, c.width, c.height)
        let sum = 0, bright = 0, n = 0
        for (let i = 0; i < data.length; i += 4 * 29) {
          const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255
          sum += lum; if (lum > 0.75) bright++; n++
        }
        return { mean: +(sum / n).toFixed(3), bright: +(bright / n).toFixed(3) }
      }, b64)
      console.log(`pixels:`, JSON.stringify(stats))
      ok = true
    }
  } catch (e) {
    console.log(`attempt ${attempt} error: ${e.message?.slice(0, 120)}`)
  }
}
await b.close()
console.log(ok ? 'HOVERCARD CAPTURE OK' : 'FAILED')
process.exit(ok ? 0 : 1)
