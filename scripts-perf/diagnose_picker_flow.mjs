// Where does the watch drive land? What buttons/text exist on the details page?
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
const clicked = await p.evaluate(() => {
  const a = [...document.querySelectorAll('a[href^="/anime/"]')].find((x) => x.getBoundingClientRect().width > 100)
  if (!a) return null
  const href = a.getAttribute('href')
  a.click()
  return href
})
console.log('clicked card:', clicked)
await sleep(6000)
const state = await p.evaluate(() => ({
  url: location.pathname + location.search,
  title: document.title,
  buttons: [...document.querySelectorAll('button, a')]
    .map((b) => b.textContent.trim().replace(/\s+/g, ' ').slice(0, 40))
    .filter((t) => t && t.length < 40)
    .slice(0, 30),
  hasServersText: /servers?/i.test(document.body.innerText),
  textSample: document.body.innerText.slice(0, 300).replace(/\n+/g, ' | '),
}))
console.log(JSON.stringify(state, null, 1))
await b.close()
