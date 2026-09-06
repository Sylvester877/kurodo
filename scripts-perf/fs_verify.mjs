// Verify the fullscreen button works with the permission fix.
// Connects to the LIVE app over CDP, navigates to a watch page, wakes
// the controls with a real mouse move, clicks the fullscreen button with
// real mouse input, and reports whether document.fullscreenElement is set.
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })
const pages = await b.pages()
let page = pages.find((p) => p.url().includes('localhost:5173')) || pages[0]

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function gotoWatch() {
  await page.goto('http://localhost:5173/watch/5114?ep=1', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  })
  // wait for <video>
  for (let i = 0; i < 40; i++) {
    const v = await page
      .evaluate(() => {
        const vid = document.querySelector('video')
        return vid ? { ready: vid.readyState, paused: vid.paused } : null
      })
      .catch(() => null)
    if (v && v.ready >= 1) break
    await sleep(1500)
  }
}

log('navigating to watch page…')
await gotoWatch()

// Wake controls with real mouse movement over the lower player area
const videoBox = await page.evaluate(() => {
  const vid = document.querySelector('video')
  if (!vid) return null
  const r = vid.getBoundingClientRect()
  return { x: r.x, y: r.y, w: r.width, h: r.height }
})
if (!videoBox) {
  console.log('NO VIDEO FOUND')
  process.exit(2)
}
log('video box:', JSON.stringify(videoBox))

// move to center-bottom of the video to wake controls
const wakeX = videoBox.x + videoBox.w / 2
const wakeY = videoBox.y + videoBox.h * 0.85
await page.mouse.move(0, 0)
await sleep(120)
await page.mouse.move(wakeX, wakeY)
await sleep(600)

// find fullscreen button (it may be in controls, aria-label or title)
const btn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('button')]
  const fs = els.find(
    (el) =>
      (el.getAttribute('aria-label') || '').toLowerCase().includes('fullscreen') ||
      (el.getAttribute('title') || '').toLowerCase().includes('fullscreen') ||
      (el.className || '').toLowerCase().includes('fullscreen'),
  )
  if (!fs) return null
  const r = fs.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, label: fs.getAttribute('aria-label') || fs.getAttribute('title') }
})
if (!btn) {
  console.log('NO FULLSCREEN BUTTON FOUND')
  process.exit(3)
}
log('fullscreen button at:', JSON.stringify(btn))

// real click
await page.mouse.move(btn.x, btn.y)
await sleep(150)
await page.mouse.click(btn.x, btn.y)
log('clicked — waiting 2.5s…')
await sleep(2500)

const state = await page.evaluate(() => ({
  fullscreenElement: !!document.fullscreenElement,
  fullscreenEnabled: document.fullscreenEnabled,
  isFullscreen: !!document.fullscreenElement,
  w: window.innerWidth,
  h: window.innerHeight,
  screenW: window.screen.width,
  screenH: window.screen.height,
}))
log('fullscreen state:', JSON.stringify(state))

await page.screenshot({ path: path.join(OUT, 'fs-fixed.png') }).catch(() => {})
log('screenshot saved')

if (state.fullscreenElement) {
  console.log('RESULT: FULLSCREEN WORKS ✅')
  process.exit(0)
} else {
  console.log('RESULT: FULLSCREEN FAILED ❌')
  process.exit(1)
}
