// Capture Schedule page network: every /api request + status + body snippet.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu'],
})
const p = await b.newPage()
const reqs = []
p.on('response', async (res) => {
  const url = res.url()
  if (!url.includes('/api/')) return
  let body = ''
  try { body = (await res.text()).slice(0, 120) } catch { /* ignore */ }
  reqs.push({ s: res.status(), u: url.replace('http://localhost:5173', ''), b: body })
})
await p.setViewport({ width: 1440, height: 900 })
await p.goto('http://localhost:5173/schedule', { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 35_000))

const state = await p.evaluate(() => ({
  outage: document.body.innerText.includes("Couldn't load the schedule"),
  rows: document.body.innerText.match(/\d+ episodes? across 7 days/)?.[0] || null,
}))
console.log('STATE:', JSON.stringify(state))
reqs.forEach((r) => console.log(r.s, r.u, '|', r.b.replace(/\n/g, ' ')))
await b.close()
