// Screenshot sweep: 20+ surfaces across the live app into ../sc/.
// Error-tolerant per stop — one dead page never kills the tour.
// Reconnects CDP per stop: the Electron window can die mid-tour (known
// issue); after a manual relaunch the sweep resumes where it stopped.
import puppeteer from 'puppeteer-core'
import { execSync, spawn } from 'node:child_process'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = '../sc'
const START = Number(process.argv[2] || 1)

// The Electron window dies intermittently on this machine (known issue,
// worst around watch-page playback). Auto-relaunch + wait for CDP.
async function ensureApp() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
      return b
    } catch {
      console.log('    app down — relaunching…')
      try { execSync('taskkill /F /IM electron.exe', { stdio: 'ignore' }) } catch { /* not running */ }
      await sleep(2000)
      spawn('npx', ['electron', '.', '--remote-debugging-port=9223'], {
        cwd: process.cwd(), detached: true, stdio: 'ignore', shell: true,
      }).unref()
      await sleep(18000)
    }
  }
  return null
}

const stops = [
  { n: '01-home', url: 'http://localhost:5173/', wait: 12000 },
  { n: '02-browse', url: 'http://localhost:5173/browse', wait: 12000 },
  { n: '03-browse-az', url: 'http://localhost:5173/browse?filter=az&letter=B', wait: 12000 },
  { n: '04-browse-genre', url: 'http://localhost:5173/browse?filter=genre&genreId=1', wait: 12000 },
  { n: '05-browse-popular', url: 'http://localhost:5173/browse?filter=popular', wait: 12000 },
  { n: '06-browse-season', url: 'http://localhost:5173/browse?filter=season', wait: 12000 },
  { n: '07-search', url: 'http://localhost:5173/search?q=naruto', wait: 12000 },
  { n: '08-details-fma', url: 'http://localhost:5173/anime/5114', wait: 12000 },
  { n: '09-watch-fma-dub', url: 'http://localhost:5173/watch/5114?ep=1', wait: 25000 },
  { n: '10-details-spy', url: 'http://localhost:5173/anime/140960', wait: 12000 },
  { n: '11-watch-spy', url: 'http://localhost:5173/watch/140960?ep=1', wait: 25000 },
  { n: '12-details-onion', url: 'http://localhost:5173/anime/21', wait: 12000 },
  { n: '13-details-bebop', url: 'http://localhost:5173/anime/1', wait: 12000 },
  { n: '14-watch-bebop', url: 'http://localhost:5173/watch/1?ep=1', wait: 25000 },
  { n: '15-details-deathnote', url: 'http://localhost:5173/anime/1535', wait: 12000 },
  { n: '16-watch-deathnote', url: 'http://localhost:5173/watch/1535?ep=2', wait: 25000 },
  { n: '17-details-attackontitan', url: 'http://localhost:5173/anime/16498', wait: 12000 },
  { n: '18-details-steinsgate', url: 'http://localhost:5173/anime/9253', wait: 12000 },
  { n: '19-details-gintama', url: 'http://localhost:5173/anime/918', wait: 12000 },
  { n: '20-details-hxh', url: 'http://localhost:5173/anime/11061', wait: 12000 },
  { n: '21-details-frieren', url: 'http://localhost:5173/anime/154587', wait: 12000 },
  { n: '22-details-jjk', url: 'http://localhost:5173/anime/113415', wait: 12000 },
  { n: '23-details-bleach', url: 'http://localhost:5173/anime/269', wait: 12000 },
  { n: '24-watchlist', url: 'http://localhost:5173/watchlist', wait: 8000 },
  { n: '25-schedule', url: 'http://localhost:5173/schedule', wait: 10000 },
  { n: '26-settings', url: 'http://localhost:5173/settings', wait: 8000 },
]

let ok = 0, fail = 0
for (let i = 0; i < stops.length; i++) {
  const s = stops[i]
  if (i + 1 < START) continue
  for (let retry = 0; retry < 2; retry++) {
    let browser = null
    try {
      browser = await ensureApp()
      if (!browser) throw new Error('app unreachable after relaunch')
      const pages = (await browser.pages()).filter((x) => !x.url().startsWith('devtools'))
      const page = pages[0]
      if (!page) throw new Error('NO_PAGE')
      await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await sleep(s.wait)
      await page.screenshot({ path: `${OUT}/sweep-${s.n}.png` })
      console.log(`OK  ${s.n}`)
      ok++
      break
    } catch (e) {
      if (retry === 1) {
        console.log(`ERR ${s.n}: ${e.message.slice(0, 80)}`)
        fail++
      }
    } finally {
      try { await browser?.disconnect() } catch { /* already gone */ }
    }
  }
}
console.log(`\nDONE: ${ok} ok, ${fail} failed`)
process.exit(0)
