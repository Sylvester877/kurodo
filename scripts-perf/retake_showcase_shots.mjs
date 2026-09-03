// High-quality showcase screenshot pass with per-shot verification + auto-retake.
// • deviceScaleFactor 2 (retina) for crisp README images
// • SetupWizard pre-dismissed (fresh profiles otherwise black-veil every page)
// • Each shot is pixel-verified: enough variance = real content; skeletons /
//   blank pages / overlays fail and trigger a retake (up to 3 attempts).
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'docs')
fs.mkdirSync(OUT, { recursive: true })
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})

async function newPage() {
  const p = await b.newPage()
  await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 })
  await p.evaluateOnNewDocument(() => {
    localStorage.setItem('kurodo-setup-done', '1')
    localStorage.setItem('kurodo-setup-shown', '1')
  })
  return p
}

/** Pixel stats via in-page canvas: mean luminance + stddev (variance = content). */
async function pixelStats(page, file) {
  const b64 = fs.readFileSync(file).toString('base64')
  return page.evaluate(async (b64) => {
    const resp = await fetch(`data:image/png;base64,${b64}`)
    const bmp = await createImageBitmap(await resp.blob())
    const c = document.createElement('canvas')
    c.width = bmp.width; c.height = bmp.height
    const ctx = c.getContext('2d')
    ctx.drawImage(bmp, 0, 0)
    const { data } = ctx.getImageData(0, 0, c.width, c.height)
    let sum = 0, sumSq = 0, bright = 0, colorful = 0, n = 0
    for (let i = 0; i < data.length; i += 4 * 41) {
      const r = data[i], g = data[i + 1], bl = data[i + 2]
      const lum = (r * 0.299 + g * 0.587 + bl * 0.114) / 255
      sum += lum; sumSq += lum * lum
      if (lum > 0.6) bright++
      if (Math.abs(r - g) > 18 || Math.abs(g - bl) > 18) colorful++
      n++
    }
    const mean = sum / n
    const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
    return { mean: +mean.toFixed(3), std: +std.toFixed(3), bright: +(bright / n).toFixed(3), colorful: +(colorful / n).toFixed(3) }
  }, b64)
}

/** DOM-level readiness probe per shot.
 * Only LARGE pulse elements count as loading skeletons — the app also uses
 * tiny animate-pulse dots/glows (live indicators, hero glow) as decoration. */
async function domReady(page, shot) {
  return page.evaluate((shot) => {
    const bigSkels = [...document.querySelectorAll('.animate-pulse')].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width >= 150 && r.top < innerHeight && r.bottom > 0
    }).length
    const imgs = [...document.images]
    const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 1).length
    const posters = document.querySelectorAll('.poster-frame img')
    const loadedPosters = [...posters].filter((i) => i.complete && i.naturalWidth > 1).length

    if (shot === 'search-results') {
      return { ok: posters.length >= 20 && loadedPosters >= posters.length * 0.9 && bigSkels === 0, bigSkels, posters: loadedPosters, total: posters.length }
    }
    if (shot === 'browse') {
      return { ok: loadedPosters >= 20 && bigSkels === 0, bigSkels, posters: loadedPosters }
    }
    if (shot === 'home') {
      // Home lazy-mounts rails; require hero content + a healthy set of loaded images
      const hasHero = document.body.innerText.includes('Featured')
      return { ok: hasHero && loaded >= 15 && bigSkels === 0, bigSkels, loaded, hasHero }
    }
    if (shot === 'watch') {
      const v = document.querySelector('video')
      return { ok: !!v && v.readyState >= 2, bigSkels, videoState: v ? v.readyState : -1 }
    }
    if (shot === 'picker') {
      // The picker's markers: Sub/H-Subs/Dub type tabs + provider family headers
      const t = document.body.innerText
      const hasTabs = /H-Subs/i.test(t) && /\bDub\b/i.test(t)
      const hasFamily = /anidap|gogoanime/i.test(t)
      return { ok: hasTabs && hasFamily && bigSkels === 0, bigSkels, hasTabs, hasFamily }
    }
    // schedule / seasonal / generic: real images loaded, no big skeleton blocks
    return { ok: loaded >= 8 && bigSkels === 0, bigSkels, loaded }
  }, shot)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Capture one shot definition with up to 3 verified attempts. */
async function capture(def, page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await def.goto(page)
      await sleep(def.settle)
      const ready = await domReady(page, def.name)
      const file = path.join(OUT, `${def.file}.png`)
      await page.screenshot({ path: file })
      const stats = await pixelStats(page, file)
      // Pass = DOM ready AND pixels show variance (std > 0.09) and brightness not near-zero
      const pass = ready.ok && stats.std > 0.09 && stats.mean > 0.05
      console.log(
        `${def.name} attempt ${attempt}: dom=${JSON.stringify(ready)} px=${JSON.stringify(stats)} → ${pass ? 'PASS' : 'RETRY'}`,
      )
      if (pass) return true
    } catch (e) {
      console.log(`${def.name} attempt ${attempt} error: ${e.message?.slice(0, 120)}`)
    }
  }
  return false
}

// ── Shot definitions ─────────────────────────────────────────────
const defs = []

defs.push({
  name: 'home', file: 'ui-home-after', settle: 9000,
  goto: async (p) => { await p.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 60000 }) },
})

defs.push({
  name: 'search-results', file: 'search-redesign-results', settle: 6500,
  goto: async (p) => {
    await p.goto('http://localhost:5173/search', { waitUntil: 'networkidle2', timeout: 60000 })
    await p.click('input[type="text"]')
    await p.type('input[type="text"]', 'naruto', { delay: 35 })
  },
})

defs.push({
  name: 'browse', file: 'ui-browse-after', settle: 8000,
  goto: async (p) => { await p.goto('http://localhost:5173/browse', { waitUntil: 'networkidle2', timeout: 60000 }) },
})

defs.push({
  name: 'schedule', file: 'loop-after-schedule', settle: 6000,
  goto: async (p) => { await p.goto('http://localhost:5173/schedule', { waitUntil: 'networkidle2', timeout: 60000 }) },
})

defs.push({
  name: 'seasonal', file: 'review-seasonal-stepper', settle: 7000,
  goto: async (p) => { await p.goto('http://localhost:5173/seasonal', { waitUntil: 'networkidle2', timeout: 60000 }) },
})

// watch + picker drive the real app like a user: search → details → Watch Now
async function driveToWatch(p, query, { pressWatch = true } = {}) {
  await p.goto(`http://localhost:5173/search?q=${encodeURIComponent(query)}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(5000)
  const href = await p.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="/anime/"]')].find((x) => x.getBoundingClientRect().width > 100)
    if (!a) return null
    const h = a.getAttribute('href')
    a.click()
    return h
  })
  if (!href) return null
  await sleep(6000)
  if (!pressWatch) return href
  await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a')]
    const watch = btns.find((b) => /^(watch now|watch|play|episode 1|start watching)/i.test(b.textContent.trim()))
    watch?.click()
  })
  await sleep(2500)
  return href
}

defs.push({
  name: 'watch', file: 'watch-playing', settle: 14000,
  goto: async (p) => { const ok = await driveToWatch(p, 'frieren'); if (!ok) throw new Error('could not reach watch page') },
})

defs.push({
  name: 'picker', file: 'review-watch-picker', settle: 6000,
  // Land on the watch page with the loaded server picker visible
  goto: async (p) => {
    const href = await driveToWatch(p, 'one piece', { pressWatch: true })
    if (!href) throw new Error('could not reach details page')
  },
})

// ── Run all shots ────────────────────────────────────────────────
const results = {}
for (const def of defs) {
  const page = await newPage()
  results[def.name] = await capture(def, page)
  await page.close()
}
await b.close()

console.log('\n══ SUMMARY ══')
let failed = []
for (const [k, v] of Object.entries(results)) {
  console.log(`${v ? '✅' : '❌'} ${k}`)
  if (!v) failed.push(k)
}
process.exit(failed.length ? 1 : 0)
