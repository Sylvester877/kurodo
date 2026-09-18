// Verify the fullscreen + auto-next fix in the LIVE Electron window.
//
// The reported bug: "auto next doesn't play in the fullscreen version". Root
// cause was Watch.tsx swapping the player out for a placeholder whenever
// `stream` went null — and `stream` goes null on EVERY episode change — so the
// fullscreen element (which lives inside VideoPlayer) was removed from the DOM
// and the browser dropped fullscreen.
//
// This drives the real window: play → fullscreen (F) → next episode (N) and
// asserts that fullscreen is STILL held and the NEW source is playing.
//
// Launch the app with:
//   npx electron --remote-debugging-port=9222 .
import puppeteer from 'puppeteer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const WATCH_PATH = process.env.WATCH_PATH || '/watch/21?ep=1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find((p) => p.url().includes('5173')) || pages[0]

const videoState = () =>
  page.evaluate(() => {
    const v = document.querySelector('video')
    return {
      fsElement: document.fullscreenElement ? document.fullscreenElement.tagName : null,
      fsTag: document.fullscreenElement?.className?.slice(0, 40) || null,
      src: v ? (v.currentSrc || '').slice(-46) : null,
      readyState: v?.readyState ?? -1,
      paused: v ? v.paused : null,
      t: v ? +v.currentTime.toFixed(2) : null,
      h: v?.videoHeight ?? 0,
      err: v?.error?.code ?? null,
    }
  })

console.log(`opening ${WATCH_PATH} …`)
await page.goto(`http://localhost:5173${WATCH_PATH}`, { waitUntil: 'domcontentloaded' })

// Wait for actual playback of episode 1.
let st = null
for (let i = 0; i < 30; i++) {
  await sleep(2500)
  st = await videoState()
  if (st.src && !st.paused && st.t > 0.5) break
}
if (!st?.src || st.paused) {
  console.log('could not reach playback — aborting:', JSON.stringify(st))
  browser.disconnect()
  process.exit(1)
}
const firstSrc = st.src
console.log(`episode 1 playing: t=${st.t}s ${st.h}p src …${firstSrc}`)

// Make sure the player has focus (it auto-focuses on load) so key events land.
await page.evaluate(() => {
  const v = document.querySelector('video')
  const wrap = v?.closest('[tabindex]') || v?.parentElement?.parentElement
  wrap?.focus?.({ preventScroll: true })
})

await page.keyboard.press('f')
await sleep(1200)
st = await videoState()
console.log(`after F  → fullscreenElement: ${st.fsElement || 'NONE'}`)
if (!st.fsElement) {
  console.log('could not enter fullscreen via F — trying requestFullscreen directly')
  await page.evaluate(() => {
    const v = document.querySelector('video')
    const wrap = v?.closest('[tabindex]') || v?.parentElement?.parentElement
    wrap?.requestFullscreen?.()
  })
  await sleep(1200)
  st = await videoState()
  console.log(`         retry → fullscreenElement: ${st.fsElement || 'NONE'}`)
}
await page.screenshot({ path: path.join(OUT, 'fs-autonext-1-before-next.png') })

// Advance the episode while inside fullscreen — exactly what auto-next does.
console.log('\nadvancing to the next episode (N) while in fullscreen …')
await page.keyboard.press('n')

let after = null
for (let i = 0; i < 34; i++) {
  await sleep(2500)
  after = await videoState()
  if (after.src && after.src !== firstSrc && !after.paused && after.t > 0.5) break
}

console.log(`\nRESULT after next-episode:`)
console.log(`  source changed      ${after.src !== firstSrc ? 'YES' : 'NO'}  (…${after.src})`)
console.log(`  playing             ${!after.paused && after.t > 0.5 ? 'YES' : 'NO'}  t=${after.t}s  ${after.h}p  err=${after.err}`)
console.log(`  FULLSCREEN HELD     ${after.fsElement ? 'YES' : 'NO — regression, player was unmounted'}`)

await page.screenshot({ path: path.join(OUT, 'fs-autonext-2-after-next.png') })
console.log('\nshots  screenshots/fs-autonext-1-before-next.png, fs-autonext-2-after-next.png')

const pass = after.src !== firstSrc && !after.paused && !!after.fsElement
console.log(`\n${pass ? 'PASS' : 'FAIL'} — fullscreen auto-next`)
browser.disconnect()
process.exit(pass ? 0 : 1)
