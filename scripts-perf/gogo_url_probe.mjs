// Discover gogoanime.by's current episode-URL structure.
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

// 1. Where does the old-format URL land?
const testUrls = [
  'https://gogoanime.by/fullmetal-alchemist-brotherhood-episode-1-english-subbed/',
  'https://gogoanime.by/fullmetal-alchemist-brotherhood-episode-1/',
]
for (const u of testUrls) {
  try {
    const resp = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 2500))
    console.log(JSON.stringify({ tried: u, final: p.url(), status: resp?.status(), title: await p.title().then((t) => t.slice(0, 60)) }))
  } catch (e) { console.log(JSON.stringify({ tried: u, err: e.message.slice(0, 80) })) }
}

// 2. What episode links does the homepage/search produce (current pattern)?
try {
  await p.goto('https://gogoanime.by/?s=fullmetal+alchemist', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 2500))
  const links = await p.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .map((a) => a.href)
      .filter((h) => h.includes('fullmetal') || h.includes('episode'))
      .slice(0, 12),
  )
  console.log('SAMPLE LINKS:', JSON.stringify(links, null, 1))
} catch (e) { console.log('search ERR', e.message.slice(0, 100)) }

await b.close()
