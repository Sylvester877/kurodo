// Diagnose: what state is the watch page in after load?
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const b = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
})
const p = await b.newPage()
await p.setViewport({ width: 1440, height: 900 })
p.on('console', (m) => { const t = m.text(); if (t.includes('error') || t.includes('Error')) console.log('[console]', t.slice(0, 140)) })
p.on('response', (r) => { if (r.url().includes('/api/anidap/sources')) console.log('[api]', r.status(), r.url().slice(0, 110)) })

await p.goto('http://localhost:5173/watch/62331?ep=1', { waitUntil: 'domcontentloaded', timeout: 45000 })
await new Promise((r) => setTimeout(r, 12000))
const s1 = await p.evaluate(() => ({
  url: location.href,
  h1: document.querySelector('h1')?.textContent?.slice(0, 60) || null,
  buttons: [...document.querySelectorAll('button')].map((x) => x.textContent?.trim()).filter(Boolean).slice(0, 20),
  bodySnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
  hasVideo: !!document.querySelector('video'),
}))
console.log(JSON.stringify(s1, null, 1))

// wait more, probe again
await new Promise((r) => setTimeout(r, 20000))
const s2 = await p.evaluate(() => ({
  hasVideo: !!document.querySelector('video'),
  videoSrc: (document.querySelector('video')?.currentSrc || document.querySelector('video')?.src || '').slice(0, 100),
  bodySnippet: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
}))
console.log('AFTER 30s:', JSON.stringify(s2, null, 1))
await b.close()
