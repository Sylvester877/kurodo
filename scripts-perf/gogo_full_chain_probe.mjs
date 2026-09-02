// Follow the FULL gogoanime chain: episode -> player (referer) -> megavid -> video?
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const EP = 'https://gogoanime.by/liar-game-episode-1/'
const PLAYER = 'https://gogoanime.by/player/?source=embed&url=V3oraS9OdVNOdFNoTUZuWm9qa1FrRWtnd3FZTmJlM3hXRWVzdmZqRVorZmtrbVUzN3lINUZ6MDREdFR2aWZuMA%3D%3D'

// Step 1: player page with referer -> get megavid iframe
const p1 = await b.newPage()
await p1.setUserAgent(UA)
await p1.setExtraHTTPHeaders({ Referer: EP })
await p1.goto(PLAYER, { waitUntil: 'domcontentloaded', timeout: 30000 })
await new Promise((r) => setTimeout(r, 3000))
const megavid = await p1.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.src).find(Boolean))
console.log('MEGAVID:', megavid)
await p1.close()

if (megavid) {
  // Step 2: megavid page with gogoanime referer
  const p2 = await b.newPage()
  await p2.setUserAgent(UA)
  await p2.setExtraHTTPHeaders({ Referer: 'https://gogoanime.by/' })
  const resp = await p2.goto(megavid, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => { console.log('megavid err:', e.message.slice(0, 90)); return null })
  await new Promise((r) => setTimeout(r, 5000))
  console.log('MEGAVID FINAL URL:', p2.url())
  console.log('MEGAVID STATUS:', resp?.status())
  const dump = await p2.evaluate(() => ({
    title: document.title.slice(0, 60),
    vids: [...document.querySelectorAll('video')].map((v) => (v.currentSrc || v.src || '').slice(0, 120)),
    iframes: [...document.querySelectorAll('iframe')].map((f) => f.src?.slice(0, 120)),
    packed: [...document.querySelectorAll('script')]
      .map((s) => s.textContent || '')
      .filter((t) => t.includes('.m3u8') || t.includes('.mp4') || t.includes('eval(function(p,a,c,k,e'))
      .map((t) => t.replace(/\s+/g, ' ').slice(0, 350)),
    bodySnippet: document.body?.innerText?.replace(/\s+/g, ' ').slice(0, 200),
  }))
  console.log(JSON.stringify(dump, null, 1))
  await p2.close()
}
await b.close()
