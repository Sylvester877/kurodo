/**
 * Per-server screenshot harness — clicks every server chip in the picker
 * and captures the app playing (or honestly failing) on each one.
 *
 * For each title:
 *   1. Open /watch/<malId>, wait for the provider list.
 *   2. Click each server chip (Kiwi, Neko, Sora, …).
 *   3. Wait for the <video> to receive stream data (≤40s), then screenshot.
 *
 * Output: screenshots/srv-<title>-<server>.png
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

// /watch/:id expects the MAL id.
const TITLES = [
  { id: 57555, slug: 'reze' },
  { id: 51009, slug: 'jjk' },
]

const SERVER_RE =
  /^(kiwi|neko|sora|mimi|beep|yuki|kami|koto|miku|wave|shiro|chill|zaza|nakuru|otakuhg|sakura|kryntal)/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function dismissSetup(browser) {
  const page = await browser.newPage()
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(1500)
    await page.evaluate(() => {
      ;[...document.querySelectorAll('button')]
        .find((b) => /skip setup/i.test(b.textContent))
        ?.click()
    })
    await sleep(1000)
  } finally {
    await page.close()
  }
}

const getChips = (page) =>
  page.evaluate(() => {
    const re =
      /^(kiwi|neko|sora|mimi|beep|yuki|kami|koto|miku|wave|shiro|chill|zaza|nakuru|otakuhg|sakura|kryntal)/i
    return [...document.querySelectorAll('button')]
      .map((b) => ({ text: b.textContent.trim().replace(/\s+/g, ' '), cls: b.className }))
      .filter((b) => re.test(b.text) && b.text.length < 45)
  })

const videoState = (page) =>
  page.evaluate(() => {
    const v = document.querySelector('video')
    if (!v) return { found: false }
    return {
      found: true,
      rs: v.readyState,
      time: v.currentTime,
      w: v.videoWidth,
      h: v.videoHeight,
    }
  })

async function shootTitle(browser, { id, slug }) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 })
  try {
    await page.goto(`${BASE}/watch/${id}`, { waitUntil: 'domcontentloaded', timeout: 45000 })

    // Wait for the provider chips to render (≤60s).
    let chips = []
    for (let i = 0; i < 60; i++) {
      chips = await getChips(page)
      if (chips.length >= 3) break
      await sleep(1000)
    }
    if (chips.length === 0) {
      console.error(`✗ ${slug}: no server chips found — skipping`)
      return
    }
    console.log(`\n═══ ${slug}: ${chips.length} server chips ═══`)

    for (const chip of chips) {
      const name = chip.text.match(SERVER_RE)[1].toLowerCase()
      const out = path.join(OUT, `srv-${slug}-${name}.png`)
      // Click the chip whose text starts with this server name.
      const clicked = await page.evaluate((label) => {
        const btn = [...document
          .querySelectorAll('button')]
          .find((b) => b.textContent.trim().replace(/\s+/g, ' ').startsWith(label))
        if (!btn) return false
        btn.click()
        return true
      }, chip.text.split(' ').slice(0, 1)[0] === ''
        ? name
        : name.charAt(0).toUpperCase() + name.slice(1))
      if (!clicked) {
        console.log(`  ✗ ${name}: chip not clickable`)
        continue
      }

      // Wait for video data (≤40s).
      let vs = null
      const t0 = Date.now()
      for (let i = 0; i < 40; i++) {
        vs = await videoState(page)
        if (vs.found && vs.rs >= 2 && vs.time > 0.05) break
        await sleep(1000)
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(0)
      await sleep(2500) // let a frame paint

      const state = vs?.found
        ? `rs=${vs.rs} ${vs.w}x${vs.h} t=${vs.time.toFixed(1)}s`
        : 'no <video>'
      await page.screenshot({ path: out })
      console.log(
        `  ✓ ${name} (${secs}s): ${state} → ${path.basename(out)}`,
      )
    }
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
    await dismissSetup(browser)
    for (const t of TITLES) await shootTitle(browser, t)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
