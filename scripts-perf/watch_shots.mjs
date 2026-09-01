/**
 * Watch-page screenshot harness — captures the app actually PLAYING streams.
 *
 * For each title: open /watch/<anilistId>, wait for the <video> element to
 * receive real stream data (readyState >= 2) or the error/loading UI, then
 * screenshot the full page into screenshots/watch-<slug>.png.
 *
 * Usage:  node scripts-perf/watch_shots.mjs
 */
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.LOGIN_BASE || 'http://localhost:5173'
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

// NOTE: /watch/:id expects the MAL id (resolved to AniList internally).
const TITLES = [
  { id: 51009, slug: 'jujutsu-kaisen' },
  { id: 5114, slug: 'fma-brotherhood' },
  { id: 57555, slug: 'reze-movie' },
  { id: 21, slug: 'one-piece' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Dismiss the first-run setup wizard once (localStorage persists per context). */
async function skipSetup(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(2000)
    const skipped = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /skip setup|skip/i.test(b.textContent),
      )
      if (btn) {
        btn.click()
        return btn.textContent.trim()
      }
      return null
    })
    console.log(`setup wizard: ${skipped ? `dismissed via "${skipped}"` : 'not present'}`)
    await sleep(1500)
  } finally {
    await page.close()
  }
}

async function shoot(browser, { id, slug }) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 })
  const t0 = Date.now()
  try {
    await page.goto(`${BASE}/watch/${id}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    })
    await sleep(1500)

    // Wait until a <video> exists AND has stream data (or 75s cap).
    let videoState = null
    for (let i = 0; i < 75; i++) {
      videoState = await page.evaluate(() => {
        const v = document.querySelector('video')
        if (!v) return { found: false }
        return {
          found: true,
          readyState: v.readyState,
          src: (v.currentSrc || v.src || '').slice(0, 90),
          w: v.videoWidth,
          h: v.videoHeight,
          paused: v.paused,
          time: v.currentTime,
        }
      })
      if (videoState.found && videoState.readyState >= 2) break
      await sleep(1000)
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(0)

    // A moment for a frame to paint, then capture.
    await sleep(3000)

    // Grab the server-picker labels for the report.
    const ui = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
        .map((b) => b.textContent.trim())
        .filter((t) => t && t.length < 40)
        .slice(0, 25)
      const err = document.body.textContent.includes('Having trouble')
      return { btns, err }
    })

    const p = path.join(OUT, `watch-${slug}.png`)
    await page.screenshot({ path: p })
    console.log(
      `✓ ${slug} (${secs}s): video=${videoState?.found ? `rs=${videoState.readyState} ${videoState.w}x${videoState.h} t=${videoState.time}s` : 'MISSING'} | err=${ui.err} | → ${p}`,
    )
    console.log(`   buttons: ${ui.btns.join(' · ').slice(0, 220)}`)
  } catch (e) {
    console.error(`✗ ${slug}: ${e.message}`)
  } finally {
    await page.close()
  }
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  })
  try {
    await skipSetup(browser)
    for (const t of TITLES) await shoot(browser, t)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
