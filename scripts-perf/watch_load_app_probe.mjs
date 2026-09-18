// IN-APP time-to-play probe — the number the user actually feels.
//
// watch_load_probe.mjs times the API stages; this measures the WALL CLOCK from
// navigating to a Watch URL until the <video> element is genuinely playing the
// first frame. That includes everything the user waits through: React mount,
// slug resolve, server list, stream extraction, hls.js attach, first fragment.
//
// Restart the backend before running so the in-memory caches are cold.
// Usage: node scripts-perf/watch_load_app_probe.mjs [id,id,...]
import puppeteer from 'puppeteer'

const IDS = (process.argv[2] || '21,16498,5114,11061').split(',').map((s) => s.trim())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null })
const pages = await browser.pages()
const page = pages.find((p) => p.url().includes('5173')) || pages[0]

async function state() {
  return page.evaluate(() => {
    const v = document.querySelector('video')
    const txt = document.body.innerText || ''
    return {
      hasVideo: !!v,
      src: v ? (v.currentSrc || '').slice(-40) : null,
      paused: v ? v.paused : null,
      t: v ? +v.currentTime.toFixed(2) : null,
      h: v?.videoHeight ?? 0,
      err: v?.error?.code ?? null,
      loading: /Loading episode|Fetching stream|Connecting to source/i.test(txt),
      note: (txt.match(/rate.?limited.{0,40}|no stream.{0,40}/i) || [])[0] || null,
    }
  })
}

const times = []
console.log('═ IN-APP TIME-TO-PLAY (cold) ═\n')

for (const id of IDS) {
  const url = `http://localhost:5173/watch/${id}?ep=1`
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  let st = null
  let played = false
  for (let i = 0; i < 48; i++) {
    await sleep(1000)
    st = await state()
    if (st.src && !st.paused && st.t > 0.4) { played = true; break }
  }
  const ms = Date.now() - t0
  if (played) times.push(ms)
  console.log(
    `/watch/${id}  ${played ? `${(ms / 1000).toFixed(2)}s` : `FAILED after ${(ms / 1000).toFixed(1)}s`}` +
    `  ${st?.h ? st.h + 'p' : ''}${st?.note ? `  (${st.note})` : ''}`,
  )
  await sleep(600)
}

if (times.length) {
  const sorted = [...times].sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  console.log(`\n── ${times.length}/${IDS.length} played ──`)
  console.log(`  mean ${(mean / 1000).toFixed(2)}s · fastest ${(sorted[0] / 1000).toFixed(2)}s · slowest ${(sorted.at(-1) / 1000).toFixed(2)}s`)
}
browser.disconnect()
