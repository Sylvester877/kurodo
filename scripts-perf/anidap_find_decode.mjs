// Find which JS chunk consumes /api/anime/sources and where `data` is
// decrypted into a sources array. We capture all fetched chunk URLs and
// grep the ones that reference the endpoint path.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const p = await b.newPage()
const chunks = new Set()
p.on('response', (r) => {
  const u = r.url()
  if (/anidap\.lol\/assets\/.+\.js/.test(u)) chunks.add(u)
})
// Force the app to load a watch page (must reach player code)
await p.goto('https://anidap.lol/watch?id=5114&ep=1&type=sub', { waitUntil: 'networkidle2', timeout: 35000, waitUntil: 'networkidle0' }).catch(async () => {
  await new Promise((r) => setTimeout(r, 6000))
})
console.log('chunks:', chunks.size)
// Download each and grep for the sources path / decode
fs.mkdirSync('scripts-perf/chunks', { recursive: true })
for (const c of chunks) {
  const name = c.split('/').pop()
  const file = 'scripts-perf/chunks/' + name
  try {
    const res = await fetch(c)
    const txt = await res.text()
    fs.writeFileSync(file, txt)
    if (/sources/.test(txt)) console.log('HIT sources:', name, 'len', txt.length)
  } catch {}
}
await b.close()
console.log('done')
