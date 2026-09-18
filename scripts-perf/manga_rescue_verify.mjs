// Live verification of the publisher-notice rescue (My Dress-Up Darling ch 114.1).
// Flow: find the MD chapter id for ch 114.1 → open /manga/read/:id in the real
// Electron window → wait for pages → assert NOT the notice card → screenshot.
import WebSocket from 'ws'
import fs from 'node:fs'

const B = 'http://127.0.0.1:5173'
const SHOTS = new URL('../../screenshots/', import.meta.url).pathname.replace(/^\//, '')

// 1. Find My Dress-Up Darling on MangaDex and its 114.1 chapter
const search = await (await fetch(`${B}/api/manga/search?q=${encodeURIComponent('My Dress-Up Darling')}&limit=8`)).json()
const all = (search?.data?.results || search.results || [])
// prefer the main series entry, not a side-story like "My Dress-Up Darling 107.5"
const hit = all.filter((r) => /dress.?up/i.test(r.title || '')).sort((a, b) => (a.title.match(/\d/g)?.length || 0) - (b.title.match(/\d/g)?.length || 0))[0] || all[0]
if (!hit) { console.log('SEARCH MISS:', JSON.stringify(search).slice(0, 300)); process.exit(1) }
// hard-pin the main series UUID (title search returns side collections first)
if (!/dress.?up/i.test(hit.title || '')) hit.id = 'aa6c76f7-5f5f-46b6-a800-911145f81b9b'
console.log('manga:', hit.id, hit.title)

const feed = await (await fetch(`${B}/api/manga/chapters/${hit.id}?lang=en`)).json()
const chapters = feed?.data?.chapters || feed.chapters || []
const target = chapters.find((c) => c.chapter === '114.1') || chapters.find((c) => c.chapter === '114')
if (!target) { console.log('NO 114.1; sample:', chapters.slice(0, 5).map(c => c.chapter)); process.exit(1) }
console.log('chapter:', target.chapter, 'id:', target.id, 'externalUrl:', target.externalUrl || '(none)', 'official:', target.official)
const isNotice = (chapters.filter(c => parseFloat(c.chapter) >= 114 && parseFloat(c.chapter) <= 115))
console.log('around-114 flags:', isNotice.map(c => `${c.chapter}:${c.externalUrl ? 'PUB' : 'ok'}`).join(' '))

// 2. CDP into the real Electron window
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.log('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 })
let id = 0
const pending = new Map()
ws.on('message', (raw) => {
  const m = JSON.parse(raw)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id
  pending.set(mid, res)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
await new Promise((r) => ws.on('open', r))
await send('Page.enable')
await send('Runtime.enable')

const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}

// 3. Navigate to the chapter reader
const url = `${B}/manga/read/${target.id}?manga=${hit.id}&source=mangadex`
console.log('nav →', url)
await send('Page.navigate', { url })
await new Promise((r) => setTimeout(r, 9000))

// 4. Inspect what rendered
const state = await evalJS(`(async () => {
  const imgs = [...document.querySelectorAll('img')]
  const loaded = imgs.filter(i => i.complete && i.naturalWidth > 0)
  const noticeCard = document.body.innerText.includes('EXTERNAL CHAPTER') || document.body.innerText.includes('publisher-only')
  const rescueBadge = document.body.innerText.includes('atsu.moe')
  const mdHost = loaded.filter(i => /mangadex|uploads/.test(i.src)).length
  return {
    imgCount: imgs.length, loaded: loaded.length,
    firstSrc: imgs[0]?.src?.slice(0, 110) || null,
    noticeCard, rescueBadge,
    text: document.body.innerText.slice(0, 300),
  }
})()`)
console.log('STATE:', JSON.stringify(state, null, 2))

// 5. Screenshots
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(`screenshots/${name}.png`, Buffer.from(r.result.data, 'base64'))
  console.log('shot:', name)
}
await shot('manga-rescue-1141-top')
await evalJS(`window.scrollTo(0, document.body.scrollHeight * 0.5)`)
await new Promise((r) => setTimeout(r, 2500))
await shot('manga-rescue-1141-mid')

const verdict = !state.noticeCard && state.loaded >= 3
console.log(verdict ? '✅ RESCUE PASS — real pages, no notice card' : '❌ RESCUE FAIL')
process.exit(verdict ? 0 : 1)
