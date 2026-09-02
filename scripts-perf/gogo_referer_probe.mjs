// Test: does the gogoanime player route need the episode Referer?
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})

const EP = 'https://gogoanime.by/liar-game-episode-1/'
const PLAYER = 'https://gogoanime.by/player/?source=embed&url=V3oraS9OdVNOdFNoTUZuWm9qa1FrRWtnd3FZTmJlM3hXRWVzdmZqRVorZmtrbVUzN3lINUZ6MDREdFR2aWZuMA%3D%3D'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const p = await b.newPage()
await p.setUserAgent(UA)
// Set the episode page as referer via request interception
await p.setExtraHTTPHeaders({ Referer: EP })
const resp = await p.goto(PLAYER, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => { console.log('goto err:', e.message.slice(0, 80)); return null })
await new Promise((r) => setTimeout(r, 4000))
console.log('FINAL URL:', p.url())
console.log('STATUS:', resp?.status())
const dump = await p.evaluate(() => ({
  title: document.title.slice(0, 60),
  vids: [...document.querySelectorAll('video')].map((v) => (v.currentSrc || v.src || '').slice(0, 100)),
  iframes: [...document.querySelectorAll('iframe')].map((f) => f.src?.slice(0, 110)),
  scripts: [...document.querySelectorAll('script')]
    .map((s) => s.textContent || '')
    .filter((t) => t.includes('.m3u8') || t.includes('.mp4') || t.includes('file:'))
    .map((t) => t.replace(/\s+/g, ' ').slice(0, 250)),
}))
console.log(JSON.stringify(dump, null, 1))
await b.close()
