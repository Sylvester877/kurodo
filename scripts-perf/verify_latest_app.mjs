// Smoke-verify the running Electron app (via CDP): home renders + hover card present.
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
await p.setViewport({ width: 1600, height: 900 })
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('kurodo-setup-done', '1')
  localStorage.setItem('kurodo-setup-shown', '1')
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The Electron window loads localhost:5173; verify the same bundle in a page
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(8000)

const state = await p.evaluate(() => {
  const hero = document.body.innerText.includes('Featured') || document.body.innerText.includes('Trending')
  const cards = document.querySelectorAll('a[href^="/anime/"]').length
  const nav = document.body.innerText.includes('KURODO')
  const hasHoverWrap = !!document.querySelector('div.contents')
  return { nav, hero, cards, hasHoverWrap, title: document.title }
})

// Trigger one hover to confirm the aniclover card appears
let hoverOk = false
if (state.cards > 0) {
  const t = await p.evaluate(() => {
    const el = [...document.querySelectorAll('a[href^="/anime/"]')].find((c) => {
      const r = c.getBoundingClientRect()
      return r.width > 120 && r.top > 80 && r.bottom < innerHeight
    })
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (t) {
    await p.mouse.move(t.x, t.y)
    await sleep(1300)
    hoverOk = await p.evaluate(() =>
      [...document.querySelectorAll('div')].some((d) =>
        d.className?.toString?.().includes('bg-zinc-900') &&
        d.textContent.includes('Click to view details'),
      ),
    )
  }
}
console.log(JSON.stringify({ ...state, hoverOk }, null, 1))
await b.close()
console.log(state.nav && state.cards > 0 && hoverOk ? 'APP LATEST OK' : 'CHECK FAILED')
