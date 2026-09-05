// Why is the video stalled? Capture video events, hls.js state, errors.
import WebSocket from 'ws'
import fs from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.on('open', r))
  let rid = 0
  const call = (method, params = {}) => new Promise((res, rej) => {
    const id = ++rid
    const to = setTimeout(() => rej(new Error('timeout: ' + method)), 12000)
    const onMsg = (raw) => {
      const m = JSON.parse(raw)
      if (m.id === id) { ws.off('message', onMsg); clearTimeout(to); m.result ? res(m.result) : rej(new Error(JSON.stringify(m.error || 'err'))) }
    }
    ws.on('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evalJs = async (expr) => (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value
  return { ws, page, call, evalJs }
}

let { ws, page, call, evalJs } = await connect()
console.log('url:', page.url)

// Install event loggers.
await evalJs(`(() => {
  const v = document.querySelector('video')
  if (!v) return 'no video'
  if (window.__vlog) return 'already'
  window.__vlog = []
  for (const ev of ['stalled','waiting','playing','pause','error','seeking','seeked','canplay','loadeddata','progress','ended','abort']) {
    v.addEventListener(ev, () => window.__vlog.push(ev + '@' + v.currentTime.toFixed(1) + '+' + Date.now()))
  }
  return 'logged'
})()`)

const diag = await evalJs(`(() => {
  const v = document.querySelector('video')
  if (!v) return { hasVideo: false }
  const ranges = []
  for (let i = 0; i < v.buffered.length; i++) ranges.push([+v.buffered.start(i).toFixed(1), +v.buffered.end(i).toFixed(1)])
  return {
    hasVideo: true,
    t: +v.currentTime.toFixed(1), paused: v.paused, ended: v.ended,
    ready: v.readyState, network: v.networkState,
    buffered: ranges,
    src: (v.currentSrc || '').slice(0, 100),
    error: v.error ? v.error.code + '/' + v.error.message : null,
    playbackRate: v.playbackRate,
    quality: v.getVideoPlaybackQuality ? { dropped: v.getVideoPlaybackQuality().droppedVideoFrames, total: v.getVideoPlaybackQuality().totalVideoFrames } : null,
  }
})()`)
console.log(JSON.stringify(diag, null, 2))

// Watch events for 8s while attempting play.
await evalJs(`(() => { const v = document.querySelector('video'); v.play().catch(e => window.__vlog.push('play-reject:' + e.name)); return 1 })()`)
await sleep(8000)
const log = await evalJs(`window.__vlog`)
console.log('events:', JSON.stringify(log))
const now = await evalJs(`(() => { const v = document.querySelector('video'); return { t: +v.currentTime.toFixed(1), paused: v.paused, buf: v.buffered.length ? +v.buffered.end(v.buffered.length-1).toFixed(1) : 0 } })()`)
console.log('final:', JSON.stringify(now))
ws.close()
process.exit(0)
