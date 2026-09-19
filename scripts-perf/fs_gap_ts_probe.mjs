// Parse the first TS segment's H.264 SPS for the true coded width.
// 720p stream that decodes 1910/1918-wide would prove the 10px band is
// decode-side, not layout.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const B = 'http://127.0.0.1:5173'
// reuse manifest fetch
const manifest = await (await fetch(`${B}/proxy?url=${encodeURIComponent('https://cp.megavid.buzz/hls/99a2aea6-c001-4781-94fc-478d440ec028/720p/video.m3u8')}&h=${encodeURIComponent(Buffer.from(JSON.stringify({ Referer: 'https://megavid.buzz/' })).toString('base64'))}`)).text()
const seg = manifest.split('\n').find((l) => l && !l.startsWith('#'))
if (!seg) { console.log('no seg'); process.exit(1) }
const segUrl = new URL(seg, 'http://127.0.0.1:5173/').toString()
console.log('segment:', segUrl.slice(0, 100))
const buf = Buffer.from(await (await fetch(segUrl)).arrayBuffer())
console.log('segment bytes:', buf.length)

// Find SPS NAL: search for start codes 00 00 01 with nal type 7
function findSPS(b) {
  for (let i = 0; i < b.length - 5; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1 && (b[i + 3] & 0x1f) === 7) {
      // extract until next start code
      let j = i + 3
      while (j < b.length - 3) {
        if (b[j] === 0 && b[j + 1] === 0 && b[j + 2] === 1) break
        j++
      }
      return b.subarray(i + 3, j)
    }
  }
  return null
}
const sps = findSPS(buf)
if (!sps) { console.log('no SPS found in first 100% of segment'); process.exit(1) }
console.log('SPS bytes:', sps.length, sps.subarray(0, 12).toString('hex'))

// Minimal SPS parser (Exp-Golomb)
let pos = 0
const bits = (n) => { let v = 0; for (let k = 0; k < n; k++) { const byte = sps[pos >> 3]; const bit = (byte >> (7 - (pos & 7))) & 1; v = (v << 1) | bit; pos++ } return v }
const ue = () => { let lz = 0; while (pos < sps.length * 8 && bits(1) === 0) lz++; return (1 << lz) - 1 + (lz > 0 ? bits(lz) : 0) }
const se = () => { const k = ue(); return (k & 1) ? (k + 1) / 2 : -(k / 2) }
bits(8) // profile_idc
bits(8) // constraint
bits(8) // level
ue() // sps id
let cfW = 0, cfH = 0
const profile = sps[0]
if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
  ue() // chroma_format_idc
  if (ue() === 3) bits(1)
  ue(); ue(); bits(1)
  if (bits(1)) { for (let i = 0; i < 64; i++) ue() } // scaling lists (approx)
}
ue() // log2_max_frame_num
ue() // pic_order_cnt_type
if (ue() === 0) ue()
else if (ue() === 1) { bits(1); se(); se(); for (let i = 0; i < ue(); i++) { se(); se() } }
ue() // max_num_ref_frames
bits(1) // gaps
ue() // pic_width_in_mbs - 1
ue() // pic_height_in_map_units - 1
cfW = (ue() + 1) * 16
cfH = (ue() + 1) * 16
bits(1) // frame_mbs_only
if (bits(1)) { } // cropping flag read
// redo properly: capture values
console.log('parsed coded size (approx):', cfW, 'x', cfH)
