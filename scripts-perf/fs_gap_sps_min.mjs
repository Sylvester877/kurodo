// Hex dump each SPS NAL — small, no parse loops that can hang.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const B = 'http://127.0.0.1:5173'
const H = encodeURIComponent(Buffer.from(JSON.stringify({ Referer: 'https://megavid.buzz/' })).toString('base64'))
const manifest = await (await fetch(`${B}/proxy?url=${encodeURIComponent('https://cp.megavid.buzz/hls/99a2aea6-c001-4781-94fc-478d440ec028/720p/video.m3u8')}&h=${H}`)).text()
const seg = manifest.split('\n').find((l) => l && !l.startsWith('#'))
const buf = Buffer.from(await (await fetch(new URL(seg, B).toString())).arrayBuffer())

const starts = []
for (let i = 0; i < buf.length - 4; i++) {
  if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1 && (buf[i + 3] & 0x1f) === 7) starts.push(i + 3)
  if (starts.length >= 3) break
}
starts.forEach((s, idx) => {
  const raw = buf.subarray(s, s + 40)
  const clean = []
  for (let k = 0; k < raw.length; k++) {
    if (k >= 2 && raw[k] === 3 && raw[k - 1] === 0 && raw[k - 2] === 0) continue
    clean.push(raw[k])
    if (clean.length >= 32) break
  }
  console.log(`SPS#${idx} hex:`, Buffer.from(clean).toString('hex'))
})
process.exit(0)
