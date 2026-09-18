// Run the EXACT crypto functions recovered from anidap's api chunk to decrypt
// /api/anime/sources `data`, then apply the transformSourceUrl (`$`).
import fs from 'node:fs'
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const hdrs = { Referer: 'https://anidap.lol/watch?id=5114', Origin: 'https://anidap.lol', 'User-Agent': UA, Accept: 'application/json' }

// ── exact recovered functions ──
const j = 137
function x(t) {
  const e = new TextEncoder().encode(t), a = new Uint8Array(e.length)
  for (let r = 0; r < e.length; r++) a[r] = e[r] ^ j
  return Array.from(a).map((r) => r.toString(16).padStart(2, '0')).join('')
}
function R(t, e) {
  const a = new TextEncoder, r = a.encode(t), s = a.encode(e), n = new Uint8Array(r.length)
  for (let d = 0; d < r.length; d++) n[d] = r[d] ^ s[d % s.length]
  return n
}
function U(t) {
  const a = R(t, 's3cr3t_k3y_pr0xy')
  let r = ''
  const s = new Uint8Array(a)
  for (let n = 0; n < s.byteLength; n++) r += String.fromCharCode(s[n])
  return btoa(r).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const C = '10b06cdc1ca48c9fb0b94af97cc040cf'
function O(t, e) { if (e.length !== 0) for (let a = 0; a < t.length; a++) t[a] ^= e.charCodeAt(a % e.length) }
function L(t, e) {
  const a = new TextEncoder, r = a.encode(t), s = a.encode(e), n = new Uint8Array(r.length + 1 + s.length)
  n.set(r, 0); n[r.length] = 0; n.set(s, r.length + 1); O(n, C)
  let d = ''
  for (let o = 0; o < n.length; o++) d += String.fromCharCode(n[o])
  return btoa(d).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// The `/api/anime/sources` data is base64url. Try U's inverse: base64url-decode
// then XOR with the key. But data is a blob we received — the site likely
// base64url-ENCODED a Uint8Array that is itself the encrypted source config.
// Test the inverse of U: XOR decoded bytes with 's3cr3t_k3y_pr0xy'.
function b64urlToBytes(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  return new Uint8Array(Buffer.from(b, 'base64'))
}
function xorU8(bytes, key) {
  const out = new Uint8Array(bytes.length)
  const k = new TextEncoder().encode(key)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ k[i % k.length]
  return out
}

const SLUG = process.argv[2] || 'fullmetal-alchemist-brotherhood-v3mzo'
const r = await axios.get('https://anidap.lol/api/anime/sources', {
  params: { id: SLUG, ep: Number(process.argv[3] || 1), host: process.argv[4] || 'yuki', type: process.argv[5] || 'sub' },
  headers: hdrs, timeout: 15000,
})
const data = r.data?.data || ''
console.log('payload len:', data.length)
const bytes = b64urlToBytes(data)
console.log('decoded bytes:', bytes.length)

function report(label, out) {
  try {
    const s = Buffer.from(out).toString('utf8')
    // skip leading if gzip/deflate
    console.log(`[${label}] ${out.length} bytes`)
    console.log('  utf8:', JSON.stringify(s.slice(0, 200)))
    const json = s.trim().match(/^[\{\[]/)
    console.log('  looks json:', !!json)
    if (json) { try { console.log('  parsed:', JSON.stringify(JSON.parse(s)).slice(0, 300)) } catch {} }
  } catch (e) { console.log(`[${label}] err`, e.message) }
}

report('xor-key1', xorU8(bytes, 's3cr3t_k3y_pr0xy'))
report('xor-C', xorU8(bytes, C))
// Try common compression magic check
const magic = Buffer.from(bytes.slice(0, 4)).toString('hex')
console.log('magic bytes:', magic, magic === '1f8b08' ? '(gzip)' : magic === '789c' || magic === '78da' || magic === '78 9c' ? '(zlib)' : '')
