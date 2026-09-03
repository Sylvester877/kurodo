// Diagnose the 4 failing shots: what's actually rendered on home/schedule/seasonal/picker?
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
await p.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 })
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('kurodo-setup-done', '1')
  localStorage.setItem('kurodo-setup-shown', '1')
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const route of ['/', '/schedule', '/seasonal']) {
  await p.goto(`http://localhost:5173${route}`, { waitUntil: 'networkidle2', timeout: 60000 })
  await sleep(9000)
  const d = await p.evaluate(() => {
    const skels = [...document.querySelectorAll('.animate-pulse')].slice(0, 5).map((e) => ({
      cls: (e.className?.toString?.() || '').slice(0, 70),
      inViewport: e.getBoundingClientRect().top < innerHeight && e.getBoundingClientRect().bottom > 0,
      w: e.getBoundingClientRect().width,
    }))
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.slice(0, 60) ?? null,
      textSample: document.body.innerText.slice(0, 200).replace(/\n+/g, ' | '),
      skeletons: skels,
      animeCards: document.querySelectorAll('a[href^="/anime/"]').length,
      posterImgs: document.querySelectorAll('.poster-frame img').length,
      anyImgs: document.images.length,
      loadedImgs: [...document.images].filter((i) => i.complete && i.naturalWidth > 1).length,
    }
  })
  console.log(route, JSON.stringify(d, null, 1))
}
await b.close()
