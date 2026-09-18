// Enter fullscreen in the live app, then take a native OS screenshot.
import WebSocket from 'ws'
import { execSync } from 'node:child_process'
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
ws.on("error", (e) => console.log("[ws]", String(e).slice(0, 100)))
let id = 0
const send = (method, params = {}) => new Promise(res => { const i = ++id; const h = m => { if (typeof m !== 'string' && !(m instanceof Buffer)) return; const s = m.toString(); if (!s.startsWith('{')) return; let d; try { d = JSON.parse(s) } catch { return } if (d.id === i) { ws.off('message', h); res(d) } }; ws.on('message', h); ws.send(JSON.stringify({ id: i, method, params })) })
await new Promise(r => ws.on('open', r))
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
// nav to watch if not already there
const url = await ev('location.pathname')
if (!String(url).includes('/watch/')) {
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/watch/11061?ep=1' })
  await new Promise(r => setTimeout(r, 14000))
}
const st = await ev(`(() => { const v = document.querySelector('video'); return JSON.stringify({ playing: v && !v.paused, dur: v && v.duration }) })()`)
console.log('playback:', st)
// Park on a bright mid-episode scene and PLAY so the native capture has real content
await ev(`(async () => { const v = document.querySelector('video'); if (!v) return 'no video'; v.muted = true; v.currentTime = Math.min(600, v.duration * 0.45); try { await v.play() } catch (e) { return 'play-fail ' + e }; return 'playing' })()`)
await new Promise(r => setTimeout(r, 3000))
const st2 = await ev(`(() => { const v = document.querySelector('video'); return JSON.stringify({ playing: v && !v.paused, t: v && Math.round(v.currentTime) }) })()`)
console.log('after seek+play:', st2)
await ev(`(() => { const w = document.querySelector('div[class*="group relative"]'); return w ? w.requestFullscreen().then(() => 'ok').catch(e => String(e)) : 'no wrap' })()`)
await new Promise(r => setTimeout(r, 2500))
const fs1 = await ev(`JSON.stringify({ fs: !!document.fullscreenElement, cls: document.documentElement.className })`)
console.log('state:', fs1)
console.log(execSync('powershell -ExecutionPolicy Bypass -File scripts-perf/fs_os_native_shot.ps1', { encoding: 'utf8' }))
// CDP shot alongside for renderer-truth comparison
const cdp = await send('Page.captureScreenshot', { format: 'png' })
const fs2 = await import('node:fs')
fs2.writeFileSync('screenshots/fs-os-native-cdp-pair.png', Buffer.from(cdp.result.data, 'base64'))
console.log('cdp pair saved')
ws.close()
