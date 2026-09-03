// Probe: search → details → Watch Now → where are we?
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

await p.goto('http://localhost:5173/search?q=one%20piece', { waitUntil: 'networkidle2', timeout: 60000 })
await sleep(5000)
const href = await p.evaluate(() => {
  const a = [...document.querySelectorAll('a[href^="/anime/"]')].find((x) => x.getBoundingClientRect().width > 100)
  if (!a) return null
  const h = a.getAttribute('href')
  a.click()
  return h
})
console.log('details card:', href)
await sleep(6000)
const clicked = await p.evaluate(() => {
  const btns = [...document.querySelectorAll('button, a')]
  const w = btns.find((b) => /^(watch now|watch|play|episode 1|start watching)/i.test(b.textContent.trim()))
  if (!w) return false
  w.click()
  return true
})
console.log('Watch Now clicked:', clicked)
await sleep(6000)
const s = await p.evaluate(() => ({
  url: location.pathname + location.search,
  hasServers: /servers?/i.test(document.body.innerText),
  video: !!document.querySelector('video'),
  videoState: document.querySelector('video')?.readyState ?? -1,
  text: document.body.innerText.slice(0, 260).replace(/\n+/g, ' | '),
}))
console.log(JSON.stringify(s, null, 1))
await b.close()
