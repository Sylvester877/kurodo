// Proper SPS parse — ordered bit-reader, cropping-rect aware.
import puppeteer from 'puppeteer'
import fs from 'node:fs'

const B = 'http://127.0.0.1:5173'
const H = encodeURIComponent(Buffer.from(JSON.stringify({ Referer: 'https://megavid.buzz/' })).toString('base64'))
const manifest = await (await fetch(`${B}/proxy?url=${encodeURIComponent('https://cp.megavid.buzz/hls/99a2aea6-c001-4781-94fc-478d440ec028/720p/video.m3u8')}&h=${H}`)).text()
const seg = manifest.split('\n').find((l) => l && !l.startsWith('#'))
const buf = Buffer.from(await (await fetch(new URL(seg, B).toString())).arrayBuffer())

function findSPS(b) {
  for (let i = 0; i < b.length - 5; i++) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1 && (b[i + 3] & 0x1f) === 7) {
      let j = i + 3
      while (j < b.length - 3) { if (b[j] === 0 && b[j + 1] === 0 && b[j + 2] === 1) break; j++ }
      // strip emulation prevention bytes
      const raw = b.subarray(i + 3, j)
      const out = []
      for (let k = 0; k < raw.length; k++) {
        if (k >= 2 && raw[k] === 3 && raw[k - 1] === 0 && raw[k - 2] === 0) continue
        out.push(raw[k])
      }
      return Buffer.from(out)
    }
  }
  return null
}
const sps = findSPS(buf)
if (!sps) { console.log('no SPS'); process.exit(1) }

let bitPos = 0
const readBit = () => { const v = (sps[bitPos >> 3] >> (7 - (bitPos & 7))) & 1; bitPos++; return v }
const readBits = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | readBit(); return v }
const readUE = () => { let lz = 0; while (readBit() === 0) lz++; return lz === 0 ? 0 : (1 << lz) - 1 + readBits(lz) }
const readSE = () => { const k = readUE(); return (k & 1) ? (k + 1) >> 1 : -(k >> 1) }

readBits(8) // profile_idc
readBits(8) // constraints
readBits(8) // level_idc
readUE() // sps_id
const profile = sps[0]
if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
  const cf = readUE()
  if (cf === 3) readBits(1) // separate_colour_plane_flag
  readUE() // bit_depth_luma_minus8
  readUE() // bit_depth_chroma_minus8
  readBits(1) // qpprime
  const sl = readBits(1)
  if (sl) { const n = cf !== 3 ? 8 : 12; for (let i = 0; i < n; i++) if (readBits(1)) { // seq_scaling_list_present
      let sizeOfScale = i < 6 ? 16 : 64, lastScale = 8, nextScale = 8
      for (let j = 0; j < sizeOfScale; j++) { if (nextScale !== 0) { const ds = readSE(); nextScale = (lastScale + ds + 256) % 256 } lastScale = nextScale === 0 ? lastScale : nextScale }
    } }
}
readUE() // log2_max_frame_num_minus4
const pocType = readUE()
if (pocType === 0) readUE()
else if (pocType === 1) { readBits(1); readSE(); readSE(); const n = readUE(); for (let i = 0; i < n; i++) readSE() }
readUE() // max_num_ref_frames
readBits(1) // gaps_in_frame_num
const pw = readUE() + 1
const ph = readUE() + 1
const frameMbsOnly = readBits(1)
let height = ph * 16 * (frameMbsOnly ? 1 : 2)
if (!frameMbsOnly) readBits(1)
const cropFlag = readBits(1)
let cropL = 0, cropR = 0, cropT = 0, cropB = 0
if (cropFlag) {
  cropL = readUE(); cropR = readUE(); cropT = readUE(); cropB = readUE()
}
let width = pw * 16, heightC = height
// chroma 4:2:0 crop units: 2 horizontal, 2*(frame_mbs_only?1:2) vertical
width -= (cropL + cropR) * 2
heightC -= (cropT + cropB) * 2 * (frameMbsOnly ? 1 : 2)
console.log('profile:', profile, '| mb-size:', pw, 'x', ph, '| crop L/R/T/B:', cropL, cropR, cropT, cropB)
console.log('CODED DISPLAY SIZE:', width, 'x', heightC)
