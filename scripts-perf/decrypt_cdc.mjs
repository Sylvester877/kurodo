// Decrypt the anidap /api/anime/sources payload using the cipher recovered
// from the site's api chunk:
//   U(t) = XOR(base64url-decode(t), "s3cr3t_k3y_pr0xy")
//   L(t,e) = XOR(base64url-decode(t), "10b06cdc1ca48c9fb0b94af97cc040cf")
// The /api/anime/sources `data` is base64url; XOR it with each candidate
// key and see which yields readable JSON / source URLs.
import fs from 'node:fs'
import axios from 'axios'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const hdrs = { Referer: 'https://anidap.lol/watch?id=5114', Origin: 'https://anidap.lol', 'User-Agent': UA, Accept: 'application/json' }

const SLUG = process.argv[2] || 'fullmetal-alchemist-brotherhood-v3mzo'
const r = await axios.get('https://anidap.lol/api/anime/sources', {
  params: { id: SLUG, ep: Number(process.argv[3] || 1), host: process.argv[4] || 'yuki', type: process.argv[5] || 'sub' },
  headers: hdrs, timeout: 12000,
})
const data = r.data?.data || ''
console.log('payload len:', data.length, 'head:', data.slice(0, 30))

const b64 = data.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
const buf = Buffer.from(b64, 'base64')
console.log('decoded bytes:', buf.length)

function xorBytes(bytes, key) {
  const out = Buffer.alloc(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ key.charCodeAt(i % key.length)
  return out
}
function show(label, b) {
  const s = b.toString('utf8')
  const printable = [...s].filter((c) => c >= 32 && c < 127).length / s.length
  console.log(`[${label}] printable=${(printable * 100).toFixed(0)}% len=${b.length}`)
  console.log('  head:', JSON.stringify(s.slice(0, 160)))
  console.log('  has m3u8/mp4/json:', /m3u8|\.mp4|\.webm|sources|"url"|"file"/.test(s))
  console.log('  ---')
}

show('KEY1 s3cr3t_k3y_pr0xy', xorBytes(buf, 's3cr3t_k3y_pr0xy'))
show('KEY2 "10b06cdc1ca48c9fb0b94af97cc040cf"', xorBytes(buf, '10b06cdc1ca48c9fb0b94af97cc040cf'))
// Also raw / reversed
show('raw base64-decode (no xor)', buf)
