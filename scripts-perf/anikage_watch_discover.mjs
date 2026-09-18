// Find how anikage links to its watch/player page so we can study the player.
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

// Home → grab the first anime card link (likely /anime/...)
await p.goto('https://anikage.cc/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(8000)
const first = await p.evaluate(() => {
  const a = [...document.querySelectorAll('a[href]')].find((el) => {
    const h = el.getAttribute('href') || ''
    const t = (el.textContent || '').trim()
    return /\/anime\//.test(h) && t.length < 40
  })
  return a ? { href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 60) } : null
})
console.log('first anime link:', JSON.stringify(first))
if (!first) { console.log('no anime link'); await b.close(); process.exit(0) }

const detailsUrl = new URL(first.href, 'https://anikage.cc').href
console.log('details URL:', detailsUrl)
await p.goto(detailsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(9000)
console.log('details page URL now:', p.url())

const links = await p.evaluate(() => {
  const out = []
  for (const a of document.querySelectorAll('a[href]')) {
    const h = a.getAttribute('href') || ''
    if (/watch|player|episode|stream/i.test(h)) {
      out.push({ href: h.slice(0, 120), text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) })
    }
  }
  // unique by href
  const seen = new Set()
  return out.filter((o) => { if (seen.has(o.href)) return false; seen.add(o.href); return true }).slice(0, 15)
})
console.log('watch-ish links:', JSON.stringify(links, null, 1))

// If we found nothing, dump every href pattern on the page (first 30)
if (links.length === 0) {
  const all = await p.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => h && !h.startsWith('#'))
      .slice(0, 30),
  )
  console.log('all hrefs:', JSON.stringify(all, null, 1))
}
await b.close()
