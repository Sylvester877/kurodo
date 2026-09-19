// Live verify: AnimeLogo wired into AnimeDetails + Watch.
// Navigates the real Electron window (CDP), measures the logo box paint,
// screenshots both surfaces into screenshots/.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9223',
  defaultViewport: null,
})
const pages = await browser.pages()
const page = pages[0]
if (!page) { console.error('NO_PAGE'); process.exit(1) }

async function shot(name) {
  await page.screenshot({ path: `screenshots/${name}` })
  console.log(`shot: screenshots/${name}`)
}

// ── 1. Details page (Cowboy Bebop MAL 1 — known TVDB clearlogo) ──
console.log('--- AnimeDetails (/anime/1) ---')
await page.goto('http://127.0.0.1:5173/anime/1', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(6000)

const detailsProbe = await page.evaluate(() => {
  const wordmark = document.querySelector('.hero-wordmark')
  const box = wordmark?.parentElement
  const img = box?.querySelector('img')
  const r = box?.getBoundingClientRect()
  return {
    wordmarkText: wordmark?.textContent?.slice(0, 40) ?? null,
    boxH: r ? Math.round(r.height) : null,
    boxW: r ? Math.round(r.width) : null,
    hasImg: !!img,
    imgLoaded: img ? img.complete && img.naturalWidth > 0 : false,
    imgSrc: img?.src?.slice(0, 90) ?? null,
  }
})
console.log(JSON.stringify(detailsProbe, null, 2))
await shot('logo-details.png')

// ── 2. Watch page (same title) ──
console.log('--- Watch (/watch/1?ep=1) ---')
await page.goto('http://127.0.0.1:5173/watch/1?ep=1', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(9000)

const watchProbe = await page.evaluate(() => {
  const wordmarks = [...document.querySelectorAll('.hero-wordmark')]
  const small = wordmarks.find((w) => {
    const r = w.parentElement?.getBoundingClientRect()
    return r && r.height <= 60
  })
  const box = small?.parentElement
  const img = box?.querySelector('img')
  const r = box?.getBoundingClientRect()
  return {
    wordmarkText: small?.textContent?.slice(0, 40) ?? null,
    boxH: r ? Math.round(r.height) : null,
    boxW: r ? Math.round(r.width) : null,
    hasImg: !!img,
    imgLoaded: img ? img.complete && img.naturalWidth > 0 : false,
    imgSrc: img?.src?.slice(0, 90) ?? null,
  }
})
console.log(JSON.stringify(watchProbe, null, 2))
await shot('logo-watch.png')

console.log('DONE')
process.exit(0)
