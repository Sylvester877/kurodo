// Parse ALL SPS NALs in the segment — the first hit was a false positive
// inside PES payload; scan every start code and report each SPS parse.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const B = 'http://127.0.0.1:5173'
const H = encodeURIComponent(Buffer.from(JSON.stringify({ Referer: 'https://megavid.buzz/' })).toString('base64'))
const manifest = await (await fetch(`${B}/proxy?url=${encodeURIComponent('https://cp.megavid.buzz/hls/99a2aea6-c001-4781-94fc-478d440ec028/720p/video.m3u8')}&h=${H}`)).text()
const seg = manifest.split('\n').find((l) => l && !l.startsWith('#'))
const buf = Buffer.from(await (await fetch(new URL(seg, B).toString())).arrayBuffer())
console.log('segment bytes:', buf.length)

// collect all NAL start-code positions
const nals = []
for (let i = 0; i < buf.length - 3; i++) {
  if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) { nals.push({ start: i + 3, type: buf[i + 3] & 0x1f }); i += 2 }
}
const spsNals = nals.filter((n) => n.type === 7)
console.log('total NALs:', nals.length, '| SPS NALs:', spsNals.length)

function parseSPS(rawIn) {
  // strip emulation bytes
  const sps = []
  for (let k = 0; k < rawIn.length; k++) {
    if (k >= 2 && rawIn[k] === 3 && rawIn[k - 1] === 0 && raw[k - 2] === 0) continue
    sps.push(rawIn[k])
  }
  const B2 = Buffer.from(sps)
  let bitPos = 0
  const rb = () => (B2[bitPos >> 3] >> (7 - (bitPos & 7))) & 1
  const bits = (n) => { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | rb(); bitPos++ } return v }
  const ue = () => { let lz = 0; while (bitPos < B2.length * 8 && rb() === 0) lz++; if (lz > 32) throw new Error('ue overflow'); return lz === 0 ? 0 : ((1 << lz) - 1 + bits(lz)) }
  bits(8); bits(8); bits(8); ue()
  const profile = B2[0]
  if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
    const cf = ue()
    if (cf === 3) bits(1)
    ue(); ue(); bits(1)
    if (bits(1)) { const n = cf !== 3 ? 8 : 12; for (let i = 0; i < n; i++) if (bits(1)) { let ls = 8, ns = 8; const sz = i < 6 ? 16 : 64; for (let j = 0; j < sz; j++) { if (ns !== 0) { const k2 = ue(); const ds = (k2 & 1) ? (k2 + 1) >> 1 : -(k2 >> 1); ns = (ls + ds + 256) % 256 } ls = ns === 0 ? ls : ns } } }
  }
  ue(); const poc = ue()
  if (poc === 0) ue()
  else if (poc === 1) { bits(1); const se = () => { const k = ue(); return (k & 1) ? (k + 1) >> 1 : -(k >> 1) }; se(); se(); const nn = ue(); for (let i = 0; i < nn; i++) { se(); se() } }
  ue(); bits(1)
  const pw = ue() + 1, phm = ue() + 1
  const fmo = bits(1)
  let h = phm * 16 * (fmo ? 1 : 2)
  if (!fmo) bits(1)
  const crop = bits(1)
  let cl = 0, cr2 = 0, ct = 0, cb = 0
  if (crop) { cl = ue(); cr2 = ue(); ct = ue(); cb = ue() }
  const w = pw * 16 - (cl + cr2) * 2
  h = h - (ct + cb) * 2 * (fmo ? 1 : 2)
  return { w, h, profile }
}

// nal ends at next start code
spsNals.forEach((n, idx) => {
  if (idx > 2) return // first 3 are enough
  const next = nals.find((m) => m.start > n.start + 3)
  const raw = buf.subarray(n.start, next ? next.start : Math.min(n.start + 200, buf.length))
  try {
    const r = parseSPS(raw)
    console.log(`SPS#${idx}: ${r.w}x${r.h} (profile ${r.profile})`)
  } catch (e) {
    console.log(`SPS#${idx}: parse fail (${e.message}) | first bytes:`, raw.subarray(0, 10).toString('hex'))
  }
})
process.exit(0)
