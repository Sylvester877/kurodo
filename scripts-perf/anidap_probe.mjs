// Inspect the anidap watch page to find what API the REAL site uses for streams.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const p = await b.newPage()
const apis = new Set()
const look = /anidap|chad|graphql|api/ // names only, no flags issue
p.on('request', (r) => {
  const u = r.url()
  if (look.test(u)) apis.add(u.slice(0, 130))
})
try {
  await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 6000))
  console.log('FINAL URL:', p.url())
  console.log('observed APIs:')
  for (const a of apis) console.log('  ', a)
  const body = await p.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300))
  console.log('BODY:', body)
} catch (e) {
  console.log('ERR', e.message.slice(0, 90))
}
await b.close()
