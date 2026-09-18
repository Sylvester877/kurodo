// Proof shots for the server-picker health honesty pass.
//
// Opens an OBSCURE title (the long tail where nothing works upstream) and a
// POPULAR one (where servers are verified live), zooms the picker, and dumps
// the per-chip health verdicts it renders:
//   _healthy === true  → emerald dot
//   _healthy === null  → amber dot + UNVERIFIED pill
//   _healthy === false → red dot, disabled
//
// Usage: node scripts-perf/picker_health_proof.mjs [origin]
import puppeteer from 'puppeteer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'screenshots')
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5173'
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

// malId / label / expectation
const TARGETS = [
  { mal: 19901, label: 'obscure', slug: 'picker-health-obscure' },
  { mal: 21, label: 'popular', slug: 'picker-health-popular' },
]

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
})

for (const t of TARGETS) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  // Skip the first-run wizard so the picker is not hidden behind the overlay.
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('kurodo-setup-done', '1')
      localStorage.setItem('kurodo-setup-complete', '1')
      localStorage.setItem('kurodo-onboarding-done', '1')
    } catch {}
  })
  await page.goto(`${ORIGIN}/watch/${t.mal}?ep=1`, { waitUntil: 'domcontentloaded' })
  // Wait for the picker chips to render (buttons containing an uppercase type).
  await page
    .waitForFunction(() => document.body.innerText.includes('UNVERIFIED') || document.querySelectorAll('button').length > 40, { timeout: 90_000 })
    .catch(() => {})
  // Give the picker time to paint chips AND for the first probe batch to land
  // (the route returns after FAST_WAIT_MS; a re-fetch then shows more verdicts).
  await new Promise((r) => setTimeout(r, 12_000))

  const verdicts = await page.evaluate(() => {
    const out = {
      verified: 0, unverified: 0, dead: 0, chips: [],
      disabled: 0, notClickable: 0, typeTabsDisabled: 0,
    }
    for (const btn of document.querySelectorAll('button')) {
      const txt = (btn.innerText || '').trim()
      const isTypeTab = /^(Sub|Dub|H-Subs)\b/.test(txt) && !/UNVERIFIED|NO STREAM/.test(txt)
      if (isTypeTab && btn.disabled) out.typeTabsDisabled++
      if (!/^(SUB|DUB|HSUB)$/m.test(txt) && !/UNVERIFIED|NO STREAM/.test(txt)) continue
      const svg = btn.querySelector('svg')
      const cls = svg?.getAttribute('class') || ''
      const state = cls.includes('text-red')
        ? 'dead'
        : cls.includes('text-emerald')
          ? 'verified'
          : cls.includes('text-amber')
            ? 'unverified'
            : 'none'
      if (state === 'none') continue
      out[state]++
      // HARD RULE: no server tile may ever be disabled or pointer-blocked.
      if (btn.disabled) out.disabled++
      const cur = getComputedStyle(btn).cursor
      if (cur === 'not-allowed' || cur === 'default') out.notClickable++
      out.chips.push({ name: txt.split('\n')[0].slice(0, 22), state })
    }
    return out
  })

  // ── Click test: prove an UNVERIFIED chip really accepts a click ──
  const clickTest = await page.evaluate(async () => {
    const tiles = [...document.querySelectorAll('button')].filter((b) =>
      /UNVERIFIED|NO STREAM/.test(b.innerText || ''),
    )
    const target = tiles[0]
    if (!target) return { ok: true, skipped: 'every tile is already verified' }
    const name = (target.innerText || '').trim().split('\n')[0]
    const wasActive = target.className.includes('border-primary')
    target.click()
    // The click must be ACCEPTED and STICKY: an explicit pick is never
    // auto-switched away from, even when that server fails instantly (the
    // failure is reported instead of bouncing the selection elsewhere).
    // Sample at 150ms and again at 2.5s — long enough for a failed fetch to
    // have come back and tried to move the selection.
    await new Promise((r) => setTimeout(r, 150))
    const at150 = target.className.includes('border-primary')
    await new Promise((r) => setTimeout(r, 2500))
    const at2500 = target.className.includes('border-primary')
    return { ok: at150 && at2500 && !wasActive, name, wasActive, at150, at2500 }
  })
  console.log(
    clickTest.skipped
      ? `  click test: skipped — ${clickTest.skipped}`
      : `  click test (unverified/dead chip): ${clickTest.ok ? 'PASS' : 'FAIL'} — ${clickTest.name} active ${clickTest.wasActive} → @150ms ${clickTest.at150} → @2.5s ${clickTest.at2500}`,
  )

  await page.screenshot({ path: path.join(OUT, `${t.slug}-page.png`) })
  await page.screenshot({ path: path.join(OUT, `${t.slug}-full.png`), fullPage: true })
  console.log(`\n[${t.label}] mal ${t.mal} → ${t.slug}-page.png / ${t.slug}-full.png`)
  console.log(
    `  chips: verified ${verdicts.verified} · unverified ${verdicts.unverified} · dead ${verdicts.dead}`,
  )
  console.log(
    `  hidden/blocked: disabled ${verdicts.disabled} · not-clickable ${verdicts.notClickable} · disabled type tabs ${verdicts.typeTabsDisabled}`,
  )
  console.log(
    '  ' + verdicts.chips.map((c) => `${c.name}=${c.state}`).join('  '),
  )
  await page.close()
}

await browser.close()
console.log('\npicker health proof done')
