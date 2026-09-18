// Decrypt anidap.lol /api/anime/sources payloads with the site's OWN crypto
// (transcribed 1:1 from VideoPlayer-CZSQDQOV.js: Sd() key derivation, fr() XOR
// unmask, js() decrypt with prev-epoch fallback).
const bs = (e) => {
  for (; e.length % 4; ) e += '='
  return atob(e.replace(/-/g, '+').replace(/_/g, '/'))
}

const kt = new Uint8Array(
  Array.from({ length: 32 }, (_, t) => ((t * 17 + 53) ^ (t * 23 + 79) ^ (t * 31 + 124)) & 255),
)
const Me = [13, 27, 7, 19, 31, 11, 23, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151]
const He = (e, t, n) => (((e ^ t) << 1) ^ ((t ^ n) >> 1) ^ e + t + n) & 255
const Rt = (e, t) => e[t % e.length] ^ e[((t * 7 + 11) % e.length)] ^ e[((t * 13 + 17) % e.length)]
const dn = ((6 ** 3 + 47) * 60 * 1e3) // 15,780,000 ms epoch window

// WebCrypto AES-GCM in Node 18+
const subtle = globalThis.crypto.subtle

function deriveKeyBytes(epoch) {
  const t = new Uint8Array(128)
  for (let i = 0; i < 128; i++) {
    const d = Me[i % Me.length]
    t[i] = (Rt(kt, i) ^ (((epoch + i * d) & 255) ^ (i ^ d))) & 255
  }
  const n = new Uint8Array(64), r = new Uint8Array(32), a = new Uint8Array(16)
  for (let i = 0; i < 64; i++) {
    const d = t[i], p = t[i + 64], u = He(d, p, (epoch >>> (i % 16)) & 255)
    n[i] = d ^ u
  }
  for (let i = 0; i < 32; i++) {
    const d = n[i], p = n[i + 32], u = Me[(i * 3 + 7) % Me.length]
    r[i] = ((d ^ p ^ d + p + u) & 255) & 255
  }
  for (let i = 0; i < 16; i++) {
    const d = r[i], p = r[i + 16], u = (((d << 3) | (d >>> 5)) ^ ((p << 5) | (p >>> 3))) & 255
    a[i] = u ^ ((epoch >>> (i * 2)) & 255)
  }
  const c = new Uint8Array(48)
  for (let i = 0; i < 48; i++) {
    const d = (i * 7 + 11) % 32, p = (i * 13 + 17) % 32, u = (i * 19 + 23) % 32
    const f = He(r[d], r[p], r[u])
    c[i] = ((f ^ ((epoch >>> (i % 24)) & 255) ^ Rt(kt, i * 3)) & 255) & 255
  }
  const l = new Uint8Array(32)
  for (let i = 0; i < 3; i++)
    for (let d = 0; d < 32; d++) {
      const p = i === 0 ? c[d] : l[d]
      const u = c[(d * 5 + 7) % 48], f = c[(d * 11 + 13) % 48]
      const g = He(p, u, f)
      l[d] = (g ^ c[(d + i * 16) % 48]) & 255
    }
  return { aesKeyBytes: l, xorKey: a }
}

function fr(e, t) {
  const n = new Uint8Array(e.length)
  for (let r = 0; r < e.length; r++) {
    const a = r % t.length, c = t[a]
    const l = ((c << (r % 8)) | (c >>> (8 - (r % 8)))) & 255
    const i = (r * 7 + 13) & 255
    n[r] = e[r] ^ l ^ i ^ t[(a + 1) % t.length]
  }
  return n
}

async function decryptPayload(e, epoch) {
  const { aesKeyBytes, xorKey } = deriveKeyBytes(epoch)
  const aesKey = await subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['decrypt'])
  const raw = Uint8Array.from(bs(e), (d) => d.charCodeAt(0))
  const iv = raw.slice(0, 12), ct = raw.slice(12)
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct)
  return new TextDecoder().decode(fr(new Uint8Array(pt), xorKey))
}

export async function js(e) {
  const epoch = Math.floor(Date.now() / dn)
  try {
    return await decryptPayload(e, epoch)
  } catch {
    // Site fallback: previous epoch window (payload minted just before rollover)
    return await decryptPayload(e, epoch - 1)
  }
}

// ---- CLI: node anidap_decrypt_real.mjs <slug> [ep] [host] [type] ----
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('anidap_decrypt_real.mjs')) {
  const [slug = 'fullmetal-alchemist-brotherhood', ep = '1', host = 'yuki', type = 'sub'] = process.argv.slice(2)
  const url = `https://anidap.lol/api/anime/sources?id=${encodeURIComponent(slug)}&ep=${ep}&host=${host}&type=${type}`
  console.error(`fetching ${url}`)
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', Referer: 'https://anidap.lol/' } })
  const body = await res.json()
  const data = typeof body?.data === 'string' ? body.data : body?.data?.data || body?.data
  if (!data || typeof data !== 'string') {
    console.error('unexpected response shape:', JSON.stringify(body).slice(0, 300))
    process.exit(1)
  }
  console.error(`payload: ${data.length} chars`)
  try {
    const plain = await js(data)
    const obj = JSON.parse(plain)
    console.log(JSON.stringify(obj, null, 2).slice(0, 3000))
    const srcs = obj?.sources || obj?.data?.sources || []
    console.error(`\n=== ${srcs.length} sources ===`)
    for (const s of srcs.slice(0, 8)) console.error(`  [${s.quality || s.label || '?'}] ${(s.url || '').slice(0, 110)}`)
  } catch (err) {
    console.error('DECRYPT FAILED:', err.message)
    process.exit(2)
  }
}
