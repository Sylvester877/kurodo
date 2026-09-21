// Console-trace the mark→sync chain: fresh watch with console capture,
// seek near end, let the app auto-mark, dump every sync-related log line.
import puppeteer from 'puppeteer-core'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = 'http://localhost:5173' // fixes: 127.0.0.1 is a different origin (no token) — always drive localhost

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9223', defaultViewport: null })
const pages = await browser.pages()
const page = pages[0]

// Land on the app first (fresh relaunch may still be on splash/file URL).
await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' }).catch(() => {})
await sleep(3000)

// Guard: the app must be signed in as the burner.
const who = await page.evaluate(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.user?.name ?? null)
if (who !== 'Gre0dy') { console.error('ABORT — signed in as', who); process.exit(1) }
console.log('signed_in_as: Gre0dy')

const logs = []
page.on('console', (m) => { try { logs.push(m.text()) } catch {} })

await page.goto(`${ORIGIN}/watch/21?ep=1`, { waitUntil: 'domcontentloaded' })
// Let the app settle — it rewrites the URL (lang/autoplay defaults) shortly
// after mount, which navigates and would destroy the execution context.
await sleep(4000)
const ev = async (fn) => {
  for (let i = 0; i < 5; i++) {
    try { return await page.evaluate(fn) } catch (e) {
      if (!/context was destroyed|navigat/i.test(e.message)) throw e
      await sleep(1500)
    }
  }
  return null
}
// wait for the video element to be ready
let ready = false
for (let i = 0; i < 60 && !ready; i++) {
  ready = await ev(() => {
    const v = document.querySelector('video')
    return !!v && v.readyState >= 2 && v.duration > 0
  })
  if (!ready) await sleep(1000)
}
console.log('video_ready:', ready)
if (!ready) { console.error('VIDEO never ready'); process.exit(1) }

// unmuted playback speed-up: mute + 4x, then seek near the end
await ev(() => {
  const v = document.querySelector('video')
  v.muted = true
  v.playbackRate = 4
  v.currentTime = Math.max(0, v.duration - 30)
  return v.play().then(() => 'playing').catch((e) => 'play-failed: ' + e.message)
})
console.log('seek near end — waiting for ended/near-end mark…')

// poll up to 120s for ended; self-heal pauses and stream switches.
let ended = false
let lastCt = -1
for (let i = 0; i < 60 && !ended; i++) {
  const st = await ev(() => {
    const vids = [...document.querySelectorAll('video')]
    const v = vids.sort((a, b) => b.videoWidth * b.videoHeight - a.videoWidth * a.videoHeight)[0]
    if (!v) return null
    if (v.paused && !v.ended) v.play().catch(() => {})
    return { ct: v.currentTime, dur: v.duration, ended: v.ended, paused: v.paused }
  })
  if (st) {
    if (st.ended || (st.dur > 0 && st.ct >= st.dur - 0.5)) { ended = true; break }
    // if the stream switched and time reset, re-seek near the end
    if (st.dur > 0 && st.ct < st.dur - 45) {
      await ev(() => { const v = document.querySelector('video'); if (v) v.currentTime = Math.max(0, v.duration - 20); return true })
    }
    if (i % 5 === 0) console.log(`t+${i * 2}s ct=${st.ct.toFixed(1)}/${st.dur?.toFixed(0)} paused=${st.paused}`)
  }
  await sleep(2000)
}
console.log('video_ended:', ended)
await sleep(6000) // give the mark + sync chain time to run

// dump sync-related console lines
const interesting = logs.filter((l) => /sync|mark|watch|flush|pending|anilist|progress|episode.*end|auto/i.test(l))
console.log('--- console lines (sync-related) ---')
for (const l of interesting.slice(-40)) console.log(l)

// final AniList read-back for MAL 21 → AniList 21
const TOKEN = await ev(() => JSON.parse(localStorage.getItem('kurodo-anilist-auth') || 'null')?.token)
const r = await fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ query: 'query { Media(id: 21) { mediaListEntry { progress status } } }' }),
})
console.log('anilist:', JSON.stringify((await r.json()).data?.Media?.mediaListEntry))
