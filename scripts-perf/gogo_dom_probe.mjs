// Probe gogoanime.by episode page DOM: server list structure, iframes, videos.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
await p.setViewport({ width: 1280, height: 800 })
const url = process.argv[2] || 'https://gogoanime.by/fullmetal-alchemist-brotherhood-episode-1-english-subbed/'
try {
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 4000))
  const info = await p.evaluate(() => {
    const ws = document.getElementById('w-servers')
    const serverItems = ws ? ws.querySelectorAll('.player-type-link').length : -1
    const altServers = [
      ...document.querySelectorAll('[class*="server" i], [id*="server" i]'),
    ]
      .slice(0, 10)
      .map((el) => ({
        tag: el.tagName,
        cls: (el.className || '').toString().slice(0, 70),
        id: el.id,
        dtype: el.getAttribute('data-type'),
        kids: el.children.length,
      }))
    const iframes = [...document.querySelectorAll('iframe')].map((f) => f.src?.slice(0, 90)).filter(Boolean)
    const videos = [...document.querySelectorAll('video')].map((v) => v.currentSrc?.slice(0, 90) || v.src?.slice(0, 90)).filter(Boolean)
    const forms = [...document.querySelectorAll('form[action*="embed"], [data-embed], [data-src]')].slice(0, 6).map((el) => ({
      tag: el.tagName, cls: (el.className || '').toString().slice(0, 60), dsrc: (el.getAttribute('data-src') || '').slice(0, 80), dembed: el.getAttribute('data-embed'),
    }))
    return {
      title: document.title.slice(0, 70),
      hasWServers: !!ws,
      serverItems,
      altServers,
      iframes,
      videos,
      forms,
      bodyLen: document.body?.innerHTML?.length || 0,
    }
  })
  console.log(JSON.stringify(info, null, 1))
} catch (e) {
  console.log('ERR', e.message)
}
await b.close()
