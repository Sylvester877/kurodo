import fs from 'node:fs'
import path from 'node:path'

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
const OUTPUT_DIR = path.resolve('/tmp/anidap-diagnose-network')

function safeFilename(url) {
  try {
    const u = new URL(url)
    const base = `${u.hostname}${u.pathname}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
    return base
  } catch {
    return url.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
  }
}

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const networkLog = []
  const consoleLog = []
  const wsLog = []

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
    consoleLog.push(text)
  })

  page.on('pageerror', (err) => {
    consoleLog.push(`[pageerror] ${err.message}`)
  })

  page.on('request', (req) => {
    networkLog.push({
      type: 'request',
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData: req.postData() || null,
      timestamp: Date.now(),
    })
  })

  page.on('response', async (res) => {
    try {
      const headers = res.headers()
      const contentType = (headers['content-type'] || '').toLowerCase()
      let body = null
      let savedPath = null
      // Capture text bodies for API responses and JS files
      if (contentType.includes('json') || contentType.includes('javascript') || contentType.includes('text') || contentType.includes('html')) {
        try { body = await res.text() } catch {}
        if (body && (contentType.includes('javascript') || contentType.includes('json'))) {
          const filename = `${safeFilename(res.url())}_${Date.now()}.${contentType.includes('json') ? 'json' : 'js'}`
          savedPath = path.join(OUTPUT_DIR, 'assets', filename)
          fs.mkdirSync(path.dirname(savedPath), { recursive: true })
          fs.writeFileSync(savedPath, body, 'utf-8')
        }
      }
      networkLog.push({
        type: 'response',
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
        headers,
        body: body ? body.slice(0, 5000) : null,
        savedPath,
        timestamp: Date.now(),
      })
    } catch (e) {
      networkLog.push({
        type: 'response-error',
        url: res.url(),
        error: e.message,
        timestamp: Date.now(),
      })
    }
  })

  page.on('websocket', (ws) => {
    wsLog.push({ type: 'open', url: ws.url(), timestamp: Date.now() })
    ws.on('framesent', (data) => wsLog.push({ type: 'sent', url: ws.url(), data, timestamp: Date.now() }))
    ws.on('framereceived', (data) => wsLog.push({ type: 'received', url: ws.url(), data, timestamp: Date.now() }))
    ws.on('close', () => wsLog.push({ type: 'close', url: ws.url(), timestamp: Date.now() }))
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

  console.log('[diagnose] Warming up on https://anidap.lol')
  await page.goto('https://anidap.lol', { waitUntil: 'networkidle2', timeout: 30_000 })
  await new Promise(r => setTimeout(r, 3_000))

  console.log(`[diagnose] Navigating to ${WATCH_URL}`)
  await page.goto(WATCH_URL, { waitUntil: 'networkidle2', timeout: 30_000 })

  console.log('[diagnose] Waiting 20s for SPA to fetch episode data...')
  await new Promise(r => setTimeout(r, 20_000))

  // Try clicking the SUB tab/server buttons to trigger player load
  try {
    const subButton = await page.$('[data-type="sub"], .sub-button, button:has-text("SUB")')
    if (subButton) {
      console.log('[diagnose] Clicking SUB tab')
      await subButton.click()
      await new Promise(r => setTimeout(r, 5_000))
    }
  } catch (e) {
    consoleLog.push(`[click-error] ${e.message}`)
  }

  const html = await page.content()
  const title = await page.title()
  const videoInfo = await page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'))
    const iframes = Array.from(document.querySelectorAll('iframe')).map(i => i.src)
    return { videoCount: videos.length, videoSrcs: videos.map(v => v.src), iframeSrcs: iframes }
  })

  // Dump storage and cookies
  const storage = await page.evaluate(() => ({
    localStorage: Object.fromEntries(Object.entries(localStorage)),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage)),
  }))
  const cookies = await page.cookies()

  // Anti-bot detection
  const antiBotInfo = await page.evaluate(() => {
    const title = document.title || ''
    const body = document.body?.textContent?.slice(0, 500) || ''
    return { title, bodySnippet: body, hasChallenge: /just a moment|checking your browser|ddos|cloudflare/i.test(title + body) }
  })

  await page.screenshot({ path: path.join(OUTPUT_DIR, 'screenshot.png'), fullPage: false })
  fs.writeFileSync(path.join(OUTPUT_DIR, 'page.html'), html, 'utf-8')
  fs.writeFileSync(path.join(OUTPUT_DIR, 'console.log'), consoleLog.join('\n'), 'utf-8')
  fs.writeFileSync(path.join(OUTPUT_DIR, 'network.json'), JSON.stringify(networkLog, null, 2), 'utf-8')
  fs.writeFileSync(path.join(OUTPUT_DIR, 'websocket.json'), JSON.stringify(wsLog, null, 2), 'utf-8')
  fs.writeFileSync(path.join(OUTPUT_DIR, 'storage.json'), JSON.stringify({ ...storage, cookies }, null, 2), 'utf-8')
  fs.writeFileSync(path.join(OUTPUT_DIR, 'antibot.json'), JSON.stringify(antiBotInfo, null, 2), 'utf-8')
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({
    url: WATCH_URL,
    title,
    videoInfo,
    antiBotInfo,
    networkCount: networkLog.length,
    consoleCount: consoleLog.length,
    wsCount: wsLog.length,
  }, null, 2), 'utf-8')

  console.log('[diagnose] Title:', title)
  console.log('[diagnose] Video info:', JSON.stringify(videoInfo, null, 2))
  console.log('[diagnose] Anti-bot:', JSON.stringify(antiBotInfo, null, 2))
  console.log('[diagnose] Files written to', OUTPUT_DIR)

  await browser.close()
}

run().catch((err) => {
  console.error('[diagnose] Fatal error:', err)
  process.exit(1)
})
