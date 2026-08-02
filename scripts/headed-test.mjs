import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import puppeteer from 'puppeteer'

const VITE_PORT = 5173
const BASE = `http://localhost:${VITE_PORT}`

let executablePath = undefined
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
]
for (const p of chromePaths) {
  if (fs.existsSync(p)) {
    executablePath = p
    break
  }
}

async function main() {
  console.log('Starting headed automation check...')
  if (executablePath) {
    console.log(`Found system Google Chrome at: ${executablePath}`)
  } else {
    console.log('Google Chrome not found in standard paths, falling back to Puppeteer default Chromium.')
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    slowMo: 100,
    executablePath,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  })

  const [page] = await browser.pages()
  
  // Track console logs and network errors
  const consoleLogs = []
  const networkErrors = []

  page.on('console', (msg) => {
    const text = msg.text()
    consoleLogs.push({ type: msg.type(), text })
    console.log(`[Browser Console ${msg.type()}] ${text}`)
  })

  page.on('requestfailed', (req) => {
    const url = req.url()
    const errText = req.failure()?.errorText || 'Unknown error'
    networkErrors.push({ url, errText })
    console.log(`[Browser Network Failed] ${url} -> ${errText}`)
  })

  page.on('response', (res) => {
    if (res.status() >= 400) {
      const url = res.url()
      networkErrors.push({ url, status: res.status() })
      console.log(`[Browser HTTP Error] ${url} -> Status ${res.status()}`)
    }
  })

  try {
    // 1. Visit homepage
    console.log(`Navigating to ${BASE}...`)
    await page.goto(BASE, { waitUntil: 'networkidle2' })
    await sleep(3000)

    // 2. Direct navigate to Demon Slayer Ep 1 to test video
    const watchUrl = `${BASE}/watch/101922?ep=1`
    console.log(`Navigating directly to watch page: ${watchUrl}`)
    await page.goto(watchUrl, { waitUntil: 'domcontentloaded' })
    await sleep(5000) // Wait for resolvers and video loader

    // 3. Monitor video playback state
    console.log('Checking video playback state...')
    for (let i = 0; i < 6; i++) {
      const videoState = await page.evaluate(() => {
        const video = document.querySelector('video')
        if (!video) return { exists: false }
        return {
          exists: true,
          paused: video.paused,
          currentTime: video.currentTime,
          src: video.src,
          readyState: video.readyState,
          error: video.error ? { code: video.error.code, message: video.error.message } : null
        }
      })

      console.log(`Playback poll #${i + 1}:`, JSON.stringify(videoState))
      
      // If paused, try to trigger play programmatically or by clicking center
      if (videoState.exists && videoState.paused) {
        console.log('Video is paused, trying to trigger play...')
        await page.evaluate(() => {
          const video = document.querySelector('video')
          if (video) video.play().catch(e => console.log('Autoplay play check error:', e))
        })
      }

      await sleep(3000)
    }

    console.log('Finished monitoring. Leaving browser open for 10 seconds for visual inspection...')
    await sleep(10000)

  } catch (err) {
    console.error('Automation encountered an error:', err)
  } finally {
    await browser.close()
    console.log('Browser closed.')
    
    // Save report to disk
    const report = {
      timestamp: new Date().toISOString(),
      consoleLogs: consoleLogs.slice(-50), // last 50
      networkErrors
    }
    fs.writeFileSync('scripts/headed-report.json', JSON.stringify(report, null, 2))
    console.log('Headed test report saved to scripts/headed-report.json')
  }
}

main()
