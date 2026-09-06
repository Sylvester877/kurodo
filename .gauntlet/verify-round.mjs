// Post-run consolidated verify: fonts, CSP, console errors + broken images
// across key routes, plus shots of the new features.
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function cdpUp() {
  try { return (await fetch('http://127.0.0.1:9222/json/version')).ok } catch { return false }
}
for (let i = 0; i < 30; i++) { if (await cdpUp()) break; await sleep(4000) }
if (!(await cdpUp())) { console.log('NO APP'); process.exit(2) }

const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await b.pages()
const page = pages.find((p) => p.url().includes('localhost:5173')) || pages[0]

const routes = ['/', '/anime/5114']
const report = {}
for (const route of routes) {
  const errs = []
  const viols = []
  const handleErr = (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 150)) }
  page.on('console', handleErr)
  const cdp = await page.createCDPSession()
  cdp.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error') viols.push(entry.text.slice(0, 150)) })
  await cdp.send('Log.enable')
  try { await page.goto('http://localhost:5173' + route, { waitUntil: 'domcontentloaded', timeout: 40000 }) } catch {}
  await sleep(route === '/' ? 9000 : 7000)
  const info = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter((x) => x.src && x.src.startsWith('http'))
    const broken = imgs.filter((x) => x.complete && x.naturalWidth === 0).length
    const fonts = { poppins: document.fonts.check('16px Poppins'), bricolage: document.fonts.check('16px "Bricolage Grotesque"') }
    return { imgs: imgs.length, broken, fonts }
  }).catch(() => null)
  page.off('console', handleErr)
  report[route] = { errs, viols, info }
  log(route, JSON.stringify({ errs: errs.length, viols: viols.filter((v) => !v.includes('fonts.googleapis')), fonts: info?.fonts, broken: info?.broken }))
  await page.screenshot({ path: path.join(OUT, 'gauntlet-verify' + (route === '/' ? '-home' : '-details') + '.png') }).catch(() => {})
}

// catch full-body screenshots of the new features
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {})
await sleep(6000)
await page.evaluate(() => { const t = [...document.querySelectorAll('h2')].find((h) => (h.textContent || '').includes('Trending Now')); if (t) t.scrollIntoView({ block: 'center' }) }).catch(() => {})
await sleep(2500)
await page.screenshot({ path: path.join(OUT, 'gauntlet-final-home.png') }).catch(() => {})
log('final shots saved')
await b.disconnect()
process.exit(0)
