// Time-to-content stopwatch for COLD (uncached) titles.
// 1) /anime/:id → time until title + poster paint
// 2) /watch/:id?ep=1 → time until watch UI ready, then until <video> actually plays
import WebSocket from 'ws'
import fs from 'node:fs'

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } })
await new Promise((r) => ws.on('open', r))
const evalJs = async (expr) => { const m = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return m.result?.result?.value }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Candidate cold anime: valid MAL ids unlikely to be in this user's cache.
const CANDIDATES = [
  23273,   // Gatchaman Crowds (2013)
  36511,   // Mahou Shoujo Ore (2018)
  22433,   // Tamako Market (2012) — id check
]

const results = []
for (const malId of CANDIDATES) {
  const t0 = Date.now()
  await send('Page.navigate', { url: `http://127.0.0.1:5173/anime/${malId}` })
  let titleMs = null, posterMs = null, ok = false, what = ''
  const start = Date.now()
  while (Date.now() - start < 20000) {
    await sleep(300)
    const state = await evalJs(`(() => {
      const h = document.querySelector('h1') || [...document.querySelectorAll('h2')].find(h => /episode|stream|synopsis|overview/i.test(h.textContent))
      const imgs = [...document.images].filter(i => i.complete && i.naturalWidth > 100)
      const noFound = document.body.textContent.includes('not found') || document.body.textContent.includes('404')
      return { h: h?.textContent?.trim().slice(0, 40) || null, imgs: imgs.length, noFound }
    })()`)
    if (state.noFound) { what = '404'; break }
    if (state.h && titleMs == null) titleMs = Date.now() - t0
    if (state.imgs >= 2 && posterMs == null) posterMs = Date.now() - t0
    if (titleMs != null && posterMs != null) { ok = true; break }
  }
  if (!ok && !what) what = 'timeout'
  results.push({ malId, titleMs, posterMs, ok, what })
  console.log(JSON.stringify({ malId, titleMs, posterMs, ok, what }))
}

// Pick first OK candidate for the watch-page cold run
const okOne = results.find((r) => r.ok) || results[0]
if (okOne) {
  const t0 = Date.now()
  await send('Page.navigate', { url: `http://127.0.0.1:5173/watch/${okOne.malId}?ep=1` })
  let uiMs = null, videoMs = null, playingMs = null, errorTxt = null
  const start = Date.now()
  // Watch UI ready = page has its player shell (loading stage text or ep rows or server picker)
  while (Date.now() - start < 30000) {
    await sleep(300)
    const state = await evalJs(`(() => {
      const txt = document.body.textContent
      const video = document.querySelector('video')
      const v = video ? { ready: video.readyState, paused: video.paused, t: video.currentTime, w: video.videoWidth } : null
      const playerUI = txt.includes('Server') || txt.includes('server') || !!document.querySelector('video') || /Loading|stream|Episode/i.test(txt)
      const err = /no stream|unavailable|failed|error|couldn't/i.test(txt) && !/loading|retry/i.test(txt)
      return { playerUI, v, err, head: txt.slice(0, 300) }
    })()`)
    if (state.playerUI && uiMs == null) uiMs = Date.now() - t0
    if (state.v) { videoMs ??= Date.now() - t0 }
    if (state.v && state.v.ready >= 2 && state.v.w > 0 && state.v.t >= 0.3) { playingMs = Date.now() - t0; break }
    if (state.err && videoMs != null) { errorTxt = state.head.slice(0, 160); break }
  }
  console.log(JSON.stringify({ watchMal: okOne.malId, uiMs, videoMs, playingMs, errorTxt }))
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync('screenshots/ttc-watch-cold.png', Buffer.from(shot.result.data, 'base64'))
}
ws.close()
console.log('DONE')
