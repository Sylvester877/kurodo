// Live verification of the new player settings menu (anikage parity).
//
// Drives the REAL Electron window over CDP:
//   gear → root rows (Playback speed / Audio boost / Caption styles / More)
//        → More page (Incognito / Autoplay video / Autonext episode /
//                     Skip intro-outro / Skip fillers / Ambient mode)
// and proves the new settings actually take effect rather than just render:
//   • Incognito → persisted to the settings store
//   • Audio boost → a Web Audio GainNode really is created at 1 + boost/100
//     (the AudioContext is patched before load so we can read the live gain)
//
// Launch the app with:
//   npx electron --disable-gpu --remote-debugging-port=9222 .
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

// Instrument Web Audio BEFORE the app code runs: the boost feature is only
// correct if the gain node's value is read back from a real graph.
await page.evaluateOnNewDocument(() => {
  const Orig = window.AudioContext
  if (!Orig) return
  window.__kbGains = []
  window.__kbCtxs = 0
  class Patched extends Orig {
    constructor(...a) {
      super(...a)
      window.__kbCtxs += 1
    }
    createGain() {
      const g = super.createGain()
      window.__kbGains.push(g)
      return g
    }
  }
  window.AudioContext = Patched
})

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
}

// Capture the player plus every control/menu row inside it, so an open menu
// panel can never be clipped out of the frame.
const shot = async (file, clipToPlayer = true) => {
  let clip
  if (clipToPlayer) {
    clip = await page.evaluate(() => {
      const v = document.querySelector('video')
      if (!v) return null
      const host = v.closest('[data-player-root]') || v.parentElement?.parentElement || v.parentElement
      const r = v.getBoundingClientRect()
      let x = r.x
      let y = r.y
      let x2 = r.x + r.width
      let y2 = r.y + r.height
      for (const b of host.querySelectorAll('button[aria-label], [role="switch"]')) {
        const br = b.getBoundingClientRect()
        if (br.width < 4 || br.height < 4) continue
        x = Math.min(x, br.x)
        y = Math.min(y, br.y)
        x2 = Math.max(x2, br.x + br.width)
        y2 = Math.max(y2, br.y + br.height)
      }
      const pad = 10
      return {
        x: Math.max(0, x - pad),
        y: Math.max(0, y - pad),
        width: x2 - x + pad * 2,
        height: y2 - y + pad * 2,
      }
    })
  }
  await page.screenshot({
    path: path.join(OUT, file),
    ...(clip && clip.width > 100 ? { clip } : {}),
  })
  console.log(`        → screenshots/${file}`)
}

// React-controlled inputs ignore a direct `.value =` write; go through the
// native setter so React's onChange sees it.
const setRange = (sel, val) =>
  page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel)
      if (!el) return false
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, String(val))
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    },
    sel,
    val,
  )

/** Click by exact aria-label, or by prefix when the label carries a value. */
const clickAria = async (label, { prefix = false } = {}) => {
  const ok = await page.evaluate(
    (label, prefix) => {
      const el = prefix
        ? Array.from(document.querySelectorAll('button[aria-label]')).find((b) =>
            (b.getAttribute('aria-label') || '').startsWith(label),
          )
        : document.querySelector(`button[aria-label="${label}"]`)
      if (!el) return false
      el.click()
      return true
    },
    label,
    prefix,
  )
  await sleep(320)
  return ok
}

/** The panel's sub-pages all return to root through this header button. */
const backToRoot = async () => {
  await clickAria('Back to settings')
  await sleep(260)
}

const rowLabels = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('button[aria-label]'))
      .map((b) => ({
        label: b.getAttribute('aria-label'),
        text: (b.textContent || '').trim(),
        switch: b.getAttribute('role') === 'switch',
        checked: b.getAttribute('aria-checked'),
      }))
      .filter((r) => r.text.length > 0 && r.text.length < 90)
      .slice(-14),
  )

const storedSettings = () =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('kurodo-settings') || 'null')?.state ?? null
    } catch {
      return null
    }
  })

console.log(`opening ${WATCH_PATH} …`)
await page.goto(`http://localhost:5173${WATCH_PATH}`, { waitUntil: 'domcontentloaded' })

// Wait for genuine playback — the controls only mount with the player.
let st = null
for (let i = 0; i < 40; i++) {
  await sleep(2000)
  st = await page.evaluate(() => {
    const v = document.querySelector('video')
    return { src: !!v?.currentSrc, paused: v?.paused ?? true, t: v?.currentTime ?? 0 }
  })
  if (st.src && !st.paused) break
}
console.log(`player state: ${JSON.stringify(st)}`)

// Controls auto-hide; a mouse move over the video brings them back.
const box = await page.evaluate(() => {
  const v = document.querySelector('video')
  if (!v) return null
  const r = v.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (!box) {
  console.log('no <video> on the page — aborting')
  browser.disconnect()
  process.exit(1)
}
await page.mouse.move(box.x, box.y)
await sleep(700)

console.log('\n== root menu ==')
const gearOk = await clickAria('Settings')
check('gear opens the settings panel', gearOk)
await sleep(500)
const root = await rowLabels()
const rootText = root.map((r) => r.text)
console.log('        rows:', JSON.stringify(root.slice(-6)))
check('root has Playback speed with a value', rootText.some((t) => /Playback speed/.test(t) && /\dx/.test(t)))
check('root has Audio boost with a value', rootText.some((t) => /Audio boost/.test(t) && /%/.test(t)))
check('root has Caption styles with a value', rootText.some((t) => /Caption styles/.test(t)))
check('root has More', rootText.some((t) => t.startsWith('More')))

// Geometry against the reference: every root row is one line with a circular
// icon on the left and a chevron on the right, and "More" sits below a rule.
const geom = await page.evaluate(() => {
  const row = (needle) => {
    const b = Array.from(document.querySelectorAll('button[aria-label]')).find((x) =>
      (x.textContent || '').startsWith(needle),
    )
    if (!b) return null
    const r = b.getBoundingClientRect()
    const disc = b.querySelector('span[class*="rounded-full"]')
    const d = disc?.getBoundingClientRect()
    // The LAST svg descendant is the chevron (the icon is the first).
    const svgs = b.querySelectorAll('svg')
    const svg = svgs[svgs.length - 1]?.getBoundingClientRect()
    return {
      h: Math.round(r.height),
      disc: d ? `${Math.round(d.width)}x${Math.round(d.height)}` : null,
      chevronAtRight: !!svg && svg.x - r.x > r.width * 0.7,
    }
  }
  const panels = document.querySelectorAll('div[class*="border-white"]')
  return {
    speed: row('Playback speed'),
    boost: row('Audio boost'),
    captions: row('Caption styles'),
    more: row('More'),
    dividers: panels.length,
  }
})
console.log('        geometry:', JSON.stringify(geom))
check('Playback speed row is a full-width row', (geom.speed?.h ?? 0) >= 36, `h=${geom.speed?.h}`)
check('Audio boost row has a 32px circular icon disc', geom.boost?.disc === '32x32', `disc=${geom.boost?.disc}`)
check('Caption styles row has a chevron at the right', geom.captions?.chevronAtRight === true)
check('More row has a chevron at the right', geom.more?.chevronAtRight === true)
await shot('player-menu-root.png')

console.log('\n== More page ==')
check('More opens a sub-page', await clickAria('More'))
const more = await rowLabels()
const moreText = more.map((r) => r.text)
for (const want of [
  'Incognito',
  'Autoplay video',
  'Autonext episode',
  'Skip intro',
  'Skip fillers',
  'Ambient mode',
]) {
  check(`More has "${want}"`, moreText.some((t) => t.includes(want)))
}
check('More rows are real switches', more.filter((r) => r.switch).length >= 6, `${more.filter((r) => r.switch).length} switches`)
await shot('player-menu-more.png')

await backToRoot()

console.log('\n== incognito actually applies ==')
check('More → back returns to the root rows', await page.evaluate(() => !!document.querySelector('button[aria-label="More"]')))
await clickAria('More')
await sleep(260)
const incBefore = (await storedSettings())?.incognito
check('Incognito toggles on', await clickAria('Incognito'))
await sleep(400)
const incAfter = (await storedSettings())?.incognito
check('Incognito persisted to the store', incAfter === true, `before=${incBefore} after=${incAfter}`)
const incSwitch = (await rowLabels()).find((r) => r.label === 'Incognito')
check('Incognito switch reads checked', incSwitch?.checked === 'true', `aria-checked=${incSwitch?.checked}`)
await shot('player-menu-more-incognito-on.png')
// Put it back the way we found it.
await clickAria('Incognito')
await sleep(300)
check('Incognito restored to off', (await storedSettings())?.incognito === false)

await backToRoot()

console.log('\n== audio boost really builds a gain graph ==')
check('Audio boost opens', await clickAria('Audio boost', { prefix: true }))
await shot('player-menu-boost.png')
check('boost slider set to 50%', await setRange('input[aria-label="Audio boost percentage"]', 50))
await sleep(900)
const audio = await page.evaluate(() => ({
  ctxs: window.__kbCtxs ?? 0,
  gains: (window.__kbGains ?? []).map((g) => (g.gain ? +g.gain.value.toFixed(3) : null)),
}))
console.log('        web audio:', JSON.stringify(audio))
check('a MediaElementSource graph was created', audio.ctxs >= 1, `${audio.ctxs} context(s)`)
check('gain is exactly 1.5 for a +50% boost', audio.gains.includes(1.5), `gains=${JSON.stringify(audio.gains)}`)
await shot('player-menu-boost-50.png')

await backToRoot()

console.log('\n== the More toggles reach the store (not decorative) ==')
check('More reopens', await clickAria('More'))
check('Skip fillers toggles', await clickAria('Skip fillers'))
await sleep(350)
const sFill = await storedSettings()
check('Skip fillers persisted (was a dead useState)', sFill?.skipFiller === false, `skipFiller=${sFill?.skipFiller}`)
await clickAria('Skip fillers')
await sleep(300)
check('Skip fillers restored', (await storedSettings())?.skipFiller === true)

check('Autoplay video toggles', await clickAria('Autoplay video'))
await sleep(350)
const sAp = await storedSettings()
check('Autoplay video persisted off', sAp?.autoplayVideo === false, `autoplayVideo=${sAp?.autoplayVideo}`)
await shot('player-menu-more-autoplay-off.png')

// Behaviour, not just storage: with autoplay off a freshly loaded episode
// must sit paused at 0 rather than starting itself.
console.log('\n== Autoplay video OFF really means paused ==')
await page.reload({ waitUntil: 'domcontentloaded' })
let ap = null
for (let i = 0; i < 25; i++) {
  await sleep(2000)
  ap = await page.evaluate(() => {
    const v = document.querySelector('video')
    return { src: !!v?.currentSrc, paused: v?.paused ?? null, t: v?.currentTime ?? 0 }
  })
  if (ap.src) break
}
console.log('        after reload:', JSON.stringify(ap))
check('episode loaded but stayed paused', ap?.src === true && ap?.paused === true, JSON.stringify(ap))

await backToRoot()

console.log('\n== caption styles ==')
// The reload above closed the panel — reopen it like a user would.
check('gear reopens after reload', await clickAria('Settings'))
check('Caption styles opens', await clickAria('Caption styles', { prefix: true }))
const capOk = await page.evaluate(() => !!document.querySelector('input[aria-label="Caption font size"]'))
check('caption controls render', capOk)
await shot('player-menu-captions.png')

console.log('\n== restore state ==')
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('kurodo-settings') || 'null')
  if (s?.state) {
    s.state.audioBoost = 0
    s.state.incognito = false
    s.state.autoplayVideo = true
    s.state.skipFiller = true
    localStorage.setItem('kurodo-settings', JSON.stringify(s))
  }
})
const summary = JSON.parse(await page.evaluate(() => localStorage.getItem('kurodo-settings')))
console.log('        final audioBoost/incognito:', summary?.state?.audioBoost, summary?.state?.incognito)

const failed = results.filter((r) => !r.ok)
console.log(`\n== PLAYER MENU VERIFY: ${results.length - failed.length}/${results.length} passed ==`)
if (failed.length) {
  for (const f of failed) console.log(`  FAILED: ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
}
browser.disconnect()
process.exit(failed.length ? 1 : 0)
