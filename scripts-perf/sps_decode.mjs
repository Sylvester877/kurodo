// Decode the captured SPS hex → true coded display size.
// SPS payload starts AFTER the NAL header byte: hex '67' is the NAL header,
// so the byte I called profile_idc IS 0x64=100. Verify by dumping first.
const hex = '6764001facd9405005bb011000003e80000b9ea0f183196'
const b = Buffer.from(hex, 'hex')
console.log('nal_header:', '0x' + b[0].toString(16), '(type', b[0] & 0x1f, ')')
console.log('profile byte:', b[1], '| constraints:', b[2], '| level:', b[3])

const TOTAL = b.length * 8
let pos = 8 // skip NAL header byte
const rb = () => (b[pos >> 3] >> (7 - (pos & 7))) & 1
const bits = (n) => { let v = 0; for (let i = 0; i < n && pos < TOTAL; i++) { v = (v << 1) | rb(); pos++ } return v }
const ue = () => { let lz = 0; while (pos < TOTAL && rb() === 0) { lz++; if (lz > 64) return 0 } return lz === 0 ? 0 : (1 << lz) - 1 + bits(lz) }
const se = () => { const k = ue(); return (k & 1) ? (k + 1) >> 1 : -(k >> 1) }

const profile = bits(8)
console.log('== profile_idc:', profile)
bits(8) // constraints
bits(8) // level
ue() // sps_id
const cf = ue()
console.log('chroma_format_idc:', cf)
if (cf === 3) bits(1)
ue(); ue(); bits(1)
const slp = bits(1)
console.log('scaling_list:', slp)
if (slp) { const n = cf !== 3 ? 8 : 12; for (let i = 0; i < n; i++) if (pos < TOTAL && bits(1)) { let ls = 8, ns = 8; const sz = i < 6 ? 16 : 64; for (let j = 0; j < sz; j++) { if (ns !== 0) { const ds = se(); ns = (ls + ds + 256) % 256 } ls = ns === 0 ? ls : ns } } }
ue()
const poc = ue()
console.log('poc_type:', poc)
if (poc === 0) ue()
ue()
bits(1)
const pw = ue(), phm = ue()
console.log('mbs:', pw + 1, 'x', phm + 1, '→ raw', (pw + 1) * 16, 'x', (phm + 1) * 16)
const fmo = bits(1)
if (!fmo) bits(1)
const crop = bits(1)
let w = (pw + 1) * 16, h = (phm + 1) * 16 * (fmo ? 1 : 2)
if (crop) {
  const cl = ue(), cr = ue(), ct = ue(), cb = ue()
  console.log('crop L/R/T/B:', cl, cr, ct, cb)
  w -= (cl + cr) * 2
  h -= (ct + cb) * 2 * (fmo ? 1 : 2)
}
console.log('== CODED DISPLAY SIZE:', w, 'x', h, '==')
process.exit(0)
