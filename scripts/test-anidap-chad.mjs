import fs from 'node:fs'
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteerExtra.use(StealthPlugin())

const ANIDAP_BASE = 'https://anidap.lol'
const ANILIST_ID = 1735
const EP = 1
const TYPE = 'sub'
const PROVIDER = 'yuki'

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

async function run() {
  const browser = await puppeteerExtra.launch({
    headless: 'new',
    executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--mute-audio'],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })

  // Observe network for chad/anidap API calls
  const requests = []
  page.on('request', (req) => {
    const url = req.url()
    if (url.includes('chad.anidap.lol') || url.includes('anidap.lol/api/')) {
      requests.push({ url, method: req.method(), headers: req.headers() })
    }
  })
  page.on('response', async (res) => {
    const url = res.url()
    if (url.includes('chad.anidap.lol') || url.includes('anidap.lol/api/')) {
      try {
        const text = await res.text().catch(() => '')
        console.log(`[network] ${res.status()} ${url.slice(0, 120)} -> ${text.slice(0, 200)}`)
      } catch {}
    }
  })

  console.log('[test] warming up on homepage...')
  await page.goto(ANIDAP_BASE, { waitUntil: 'networkidle2', timeout: 20_000 })
  await new Promise(r => setTimeout(r, 3000))

  const watchUrl = `${ANIDAP_BASE}/watch?id=${ANILIST_ID}&ep=${EP}&type=${TYPE}&provider=${PROVIDER}`
  console.log(`[test] navigating to ${watchUrl}`)
  await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 20_000 })
  await new Promise(r => setTimeout(r, 8_000))

  // Try to extract slug from page state / url
  const slugInfo = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource')
    const chadCalls = resources.filter(r => r.name.includes('chad.anidap.lol')).map(r => r.name)
    return { href: location.href, title: document.title, chadCalls }
  })
  console.log('[test] page info:', slugInfo)

  // Try to find slug from chad calls
  const slugMatch = slugInfo.chadCalls.map(u => u.match(/id=([^&]+)/)).find(Boolean)
  let slug = slugMatch?.[1]
  if (!slug) {
    // fallback: look for a data attribute or route
    const maybe = await page.evaluate(() => {
      const el = document.querySelector('[data-slug]')
      return el?.getAttribute('data-slug') || ''
    })
    slug = maybe || 'naruto-shippuden-c20p8'
  }
  console.log(`[test] resolved slug: ${slug}`)

  // Test chad API from browser context
  const endpoints = [
    `https://chad.anidap.lol/rest/api/servers?id=${slug}&epNum=${EP}`,
    `https://chad.anidap.lol/rest/api/episodes?id=${slug}`,
    `https://chad.anidap.lol/rest/api/sources?id=${slug}&epNum=${EP}&type=${TYPE}&providerId=${PROVIDER}`,
  ]

  for (const url of endpoints) {
    console.log(`[test] fetching from page context: ${url}`)
    try {
      const result = await page.evaluate(async (u) => {
        try {
          const res = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'include' })
          const text = await res.text()
          return { ok: res.ok, status: res.status, text: text.slice(0, 2000) }
        } catch (e) {
          return { ok: false, status: 0, text: e.message }
        }
      }, url)
      console.log('[test] result:', result)
    } catch (e) {
      console.error('[test] evaluate error:', e.message)
    }
  }

  await browser.close()
}

run().catch(e => { console.error(e); process.exit(1) })
