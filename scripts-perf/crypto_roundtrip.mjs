// Verify the recovered crypto round-trips, then try to decrypt the
// /api/anime/sources payload by reversing the exact module functions.
import fs from 'node:fs'
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const hdrs = { Referer: 'https://anidap.lol/watch?id=5114', Origin: 'https://anidap.lol', 'User-Agent': UA, Accept: 'application/json' }

// ── exact recovered functions ──
const C = '10b06cdc1ca48c9fb0b94af97cc040cf'
function O(t, e) { if (e.length !== 0) for (let a = 0; a < t.length; a++) t[a] ^= e.charCodeAt(a % e.length) }
function b64url(bytes) { let d = ''; for (const b of bytes) d += String.fromCharCode(b); return btoa(d).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function b64urlDec(s) { const b = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''); return Buffer.from(b, 'base64') }

// L(t,e) = XOR(t + \0 + e, C) then base64url
function L(t, e) {
  const r = new TextEncoder().encode(t), s = new TextEncoder().encode(e)
  const n = new Uint8Array(r.length + 1 + s.length); n.set(r, 0); n[r.length] = 0; n.set(s, r.length + 1)
  O(n, C)
  return b64url(n)
}
// U(t) = XOR(t, 's3cr3t_k3y_pr0xy') then base64url
function U(t) {
  const key = 's3cr3t_k3y_pr0xy'
  const r = new TextEncoder().encode(t)
  const n = new Uint8Array(r.length)
  for (let i = 0; i < r.length; i++) n[i] = r[i] ^ key.charCodeAt(i % key.length)
  return b64url(n)
}
function x(t) { const e = new TextEncoder().encode(t), a = new Uint8Array(e.length); for (let r = 0; r < e.length; r++) a[r] = e[r] ^ 137; return Array.from(a).map((r) => r.toString(16).padStart(2, '0')).join('') }

// Round-trip check: L then inverse (xor with C, split on \0)
console.log('=== round-trip L(t,e) ===')
const lt = 'https://cdn.example.com/video.mp4', le = 'megaplay.buzz'
const enc = L(lt, le)
console.log('encoded:', enc)
const dec = b64urlDec(enc)
O(dec, C)
const str = Buffer.from(dec).toString('utf8')
const parts = str.split('\u0000')
console.log('decoded back:', JSON.stringify(parts))

// Now fetch the real payload and try to reverse
console.log('=== /api/anime/sources payload ===')
for (const host of ['yuki', 'sora', 'kiwi']) {
  const r = await axios.get('https://anidap.lol/api/anime/sources', {
    params: { id: 'fullmetal-alchemist-brotherhood-v3mzo', ep: 1, host, type: 'sub' }, headers: hdrs, timeout: 15000,
  })
  const data = r.data?.data || ''
  const bytes = b64urlDec(data)
  // reverse of L: xor with C, then split
  const buf = Buffer.from(bytes); O(buf, C)
  const s = buf.toString('utf8')
  const hasNull = s.includes('\u0000')
  const readable = [...s].filter((c) => c >= 32 && c < 127).length / s.length
  console.log(`host=${host} bytes=${bytes.length} after-XOR-C printable=${(readable * 100).toFixed(0)}% hasNull=${hasNull} head="${s.slice(0, 80).replace(/\u0000/g, '|')}"`)
}
