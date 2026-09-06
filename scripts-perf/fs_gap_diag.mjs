// Fullscreen black-gap diagnosis.
// Real-click fullscreen, then dump geometry (wrapper/video rects vs screen)
// and grab a video frame to classify black regions as either OUTSIDE the
// video element (layout letterbox) or INSIDE the pixels (baked bars).
import puppeteer from 'puppeteer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })
const pages = await b.pages()
const page = pages.find((p) => p.url().includes('localhost:5173')) || pages[0]

await page.goto('http://localhost:5173/watch/5114?ep=1', {
  waitUntil: 'domcontentloaded',
  timeout: 45000,
})

// wait for a playing video
let vbox = null
for (let i = 0; i < 50; i++) {
  vbox = await page.evaluate(() => {
    const vid = document.querySelector('video')
    if (!vid) return null
    if (vid.readyState < 1) return null
    const r = vid.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }).catch(() => null)
  if (vbox && vbox.w > 100) break
  await sleep(1500)
}
if (!vbox) { console.log('NO PLAYING VIDEO'); process.exit(2) }
console.log('video windowed box:', JSON.stringify(vbox))

// Wake controls with real mouse
await page.mouse.move(0, 0)
await sleep(150)
await page.mouse.move(vbox.x + vbox.w / 2, vbox.y + vbox.h * 0.8)
await sleep(600)

// Click real fullscreen button
const btn = await page.evaluate(() => {
  const els = [...document.querySelectorAll('button')]
  const fs = els.find(
    (el) => (el.getAttribute('aria-label') || '').toLowerCase().includes('fullscreen'),
  )
  if (!fs) return null
  const r = fs.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (!btn) { console.log('NO FS BUTTON'); process.exit(3) }
await page.mouse.move(btn.x, btn.y)
await sleep(150)
await page.mouse.click(btn.x, btn.y)
await sleep(2500)

// Geometry dump
const geo = await page.evaluate(() => {
  const fsEl = document.fullscreenElement
  const wrap = fsEl
  const video = document.querySelector('video')
  const wrapR = wrap?.getBoundingClientRect()
  const vidR = video?.getBoundingClientRect()
  const cs = video ? getComputedStyle(video) : null
  return {
    fsTag: fsEl ? fsEl.tagName + '.' + (fsEl.className || '').toString().slice(0, 60) : null,
    screen: { w: window.screen.width, h: window.screen.height },
    inner: { w: window.innerWidth, h: window.innerHeight },
    wrap: wrapR ? { x: wrapR.x, y: wrapR.y, w: wrapR.width, h: wrapR.height } : null,
    video: vidR ? { x: vidR.x, y: vidR.y, w: vidR.width, h: vidR.height } : null,
    videoObjFit: cs?.objectFit,
    videoTransform: cs?.transform,
    intrinsic: video ? { w: video.videoWidth, h: video.videoHeight } : null,
  }
})
console.log('FULLSCREEN GEOMETRY:', JSON.stringify(geo, null, 1))

// Frame pixel analysis — where is the black?
const frame = await page.evaluate(() => {
  const v = document.querySelector('video')
  if (!v || !v.videoWidth) return null
  const SW = Math.max(96, Math.floor(v.videoWidth / 3))
  const SH = Math.max(54, Math.floor(v.videoHeight / 3))
  const c = document.createElement('canvas')
  c.width = SW; c.height = SH
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(v, 0, 0, SW, SH)
  const d = ctx.getImageData(0, 0, SW, SH).data
  const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
  const colLum = [], rowLum = []
  for (let x = 0; x < SW; x++) { let s = 0; for (let y = 0; y < SH; y++) s += lum((y * SW + x) * 4); colLum.push(s / SH) }
  for (let y = 0; y < SH; y++) { let s = 0; for (let x = 0; x < SW; x++) s += lum((y * SW + x) * 4); rowLum.push(s / SW) }
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length
  const dark = (a) => a.filter((v2) => v2 < 8).length
  const edgeW = Math.max(1, Math.floor(SW * 0.08))
  const edgeH = Math.max(1, Math.floor(SH * 0.08))
  return {
    SW, SH,
    colEdge: { l: mean(colLum.slice(0, edgeW)), r: mean(colLum.slice(SW - edgeW)) },
    rowEdge: { t: mean(rowLum.slice(0, edgeH)), b: mean(rowLum.slice(SH - edgeH)) },
    darkCols: { l: dark(colLum.slice(0, edgeW)), r: dark(colLum.slice(SW - edgeW)) },
    darkRows: { t: dark(rowLum.slice(0, edgeH)), b: dark(rowLum.slice(SH - edgeH)) },
    center: mean(rowLum.slice(Math.floor(SH / 3), Math.floor((2 * SH) / 3))),
  }
})
console.log('FRAME EDGES (0=black, ~120+=bright):', JSON.stringify(frame, null, 1))

await page.screenshot({ path: path.join(OUT, 'fs-gap-diag.png') }).catch(() => {})
console.log('screenshot: fs-gap-diag.png')
await b.disconnect()
process.exit(0)
