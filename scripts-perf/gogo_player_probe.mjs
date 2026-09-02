// Deep probe: episode page -> player iframe -> what's inside the player?
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
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
await p.setUserAgent(UA)

const epUrl = process.argv[2] || 'https://gogoanime.by/liar-game-episode-1/'
try {
  await p.goto(epUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await new Promise((r) => setTimeout(r, 3000))

  // Find player iframe
  const iframeSrc = await p.evaluate(() => {
    const f = [...document.querySelectorAll('iframe')].find((f) => f.src && !f.src.includes('google'))
    return f?.src || null
  })
  console.log('IFRAME:', iframeSrc)

  if (iframeSrc) {
    const p2 = await b.newPage()
    await p2.setUserAgent(UA)
    const resp = await p2.goto(iframeSrc, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => { console.log('goto err:', e.message.slice(0, 80)); return null })
    await new Promise((r) => setTimeout(r, 4000))
    console.log('PLAYER URL:', p2.url())
    console.log('PLAYER STATUS:', resp?.status())
    const dump = await p2.evaluate(() => {
      const vids = [...document.querySelectorAll('video')].map((v) => ({
        src: (v.currentSrc || v.src || '').slice(0, 100),
        sources: [...(v.querySelectorAll('source') || [])].map((s) => s.src?.slice(0, 100)),
      }))
      const iframes = [...document.querySelectorAll('iframe')].map((f) => f.src?.slice(0, 100))
      const scripts = [...document.querySelectorAll('script')]
        .map((s) => s.textContent || '')
        .filter((t) => t.includes('.mp4') || t.includes('.m3u8') || t.includes('file') || t.includes('source'))
        .map((t) => t.replace(/\s+/g, ' ').slice(0, 300))
      return {
        title: document.title.slice(0, 60),
        vids,
        iframes,
        interestingScripts: scripts.slice(0, 5),
        bodySnippet: document.body?.innerHTML?.replace(/\s+/g, ' ').slice(0, 400),
      }
    })
    console.log(JSON.stringify(dump, null, 1))
    await p2.close()
  }
} catch (e) {
  console.log('ERR', e.message.slice(0, 120))
}
await b.close()
