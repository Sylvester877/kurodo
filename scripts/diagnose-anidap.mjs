import fs from 'node:fs'
import path from 'node:path'

// Mirror the stealth setup used by cf-harvester.js
let puppeteer
let StealthPlugin

try {
  const { default: puppeteerExtra } = await import('puppeteer-extra')
  StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default
  puppeteerExtra.use(StealthPlugin())
  puppeteer = puppeteerExtra
} catch (err) {
  console.error('[diagnose] Puppeteer not available:', err.message)
  process.exit(1)
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
  ].filter(Boolean)
  for (const c of candidates) { try { if (fs.existsSync(c)) return c } catch {} }
  return undefined
}

const WATCH_URL = 'https://anidap.lol/watch?id=1735&ep=1&type=sub&provider=yuki'
const OUTPUT_DIR = path.resolve('/tmp/anidap-diagnose')

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const logs = []

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-extensions', '--mute-audio', '--window-size=1280,720',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-first-run', '--no-default-browser-check',
      '--password-store=basic', '--use-mock-keychain',
    ],
    executablePath: findChrome() || undefined,
    ignoreDefaultArgs: ['--enable-automation'],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })

  page.on('console', (msg) => {
    const text = `[console.${msg.type()}] ${msg.text()}`
    logs.push(text)
  })

  page.on('pageerror', (err) => {
    const text = `[pageerror] ${err.message}`
    logs.push(text)
  })

  page.on('requestfailed', (req) => {
    const text = `[requestfailed] ${req.url()} — ${req.failure()?.errorText || 'unknown'}`
    logs.push(text)
  })

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
    window.chrome = { runtime: {} }
    const originalQuery = window.navigator.permissions.query
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters)
    )
  })

  console.log(`[diagnose] Navigating to ${WATCH_URL}`)
  await page.goto(WATCH_URL, { waitUntil: 'networkidle2', timeout: 30_000 })

  console.log('[diagnose] Waiting 15s for player to initialize...')
  await new Promise(r => setTimeout(r, 15_000))

  const html = await page.content()
  const title = await page.title()
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1000) || '')
  const videoInfo = await page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'))
    const iframes = Array.from(document.querySelectorAll('iframe')).map(i => i.src)
    return {
      videoCount: videos.length,
      videoSrcs: videos.map(v => v.src),
      iframeSrcs: iframes,
    }
  })

  await page.screenshot({ path: path.join(OUTPUT_DIR, 'screenshot.png'), fullPage: false })

  fs.writeFileSync(path.join(OUTPUT_DIR, 'page.html'), html, 'utf-8')
  fs.writeFileSync(path.join(OUTPUT_DIR, 'console.log'), logs.join('\n'), 'utf-8')
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({
    url: WATCH_URL,
    title,
    bodyTextPreview: bodyText,
    videoInfo,
    logCount: logs.length,
  }, null, 2), 'utf-8')

  console.log('[diagnose] Title:', title)
  console.log('[diagnose] Body preview:', bodyText.slice(0, 200))
  console.log('[diagnose] Video info:', JSON.stringify(videoInfo, null, 2))
  console.log('[diagnose] Files written to', OUTPUT_DIR)

  await browser.close()
}

run().catch((err) => {
  console.error('[diagnose] Fatal error:', err)
  process.exit(1)
})
