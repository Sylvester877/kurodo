// Find FMAB's real series page + episode links on gogoanime.by.
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

// 1. Where do the series/category URLs land?
for (const u of [
  'https://gogoanime.by/series/fullmetal-alchemist-brotherhood/',
  'https://gogoanime.by/category/fullmetal-alchemist-brotherhood/',
]) {
  try {
    const resp = await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise((r) => setTimeout(r, 2000))
    console.log(JSON.stringify({ tried: u, final: p.url(), status: resp?.status(), title: (await p.title()).slice(0, 60) }))
  } catch (e) { console.log(JSON.stringify({ tried: u, err: e.message.slice(0, 80) })) }
}

// 2. Search page: find any FMAB-related links (series OR episode).
try {
  await p.goto('https://gogoanime.by/?s=fullmetal+alchemist+brotherhood', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 2500))
  const links = await p.evaluate(() =>
    [...document.querySelectorAll('a[href*="fullmetal"]')].map((a) => a.href).slice(0, 15),
  )
  console.log('FMAB LINKS:', JSON.stringify([...new Set(links)], null, 1))
} catch (e) { console.log('ERR', e.message.slice(0, 100)) }

await b.close()
