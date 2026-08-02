// anidap-decrypt.js — AES-GCM decryption for old anidap.se API responses.
// Ported from vaishnavxd/anidap-scraper extractor.js (June 2026).
//
// The old anidap API (https://anidap.se/api/anime/sources) returns
// { success: true, data: "ENCRYPTED_BASE64_STRING" }. This module
// decrypts that payload using a time-windowed AES-GCM key derived
// from a proprietary algorithm.
//
// The decryption key changes at a fixed interval (derived from
// floor(Date.now() / windowMs)). If decryption fails with the
// current window, we retry with the previous window.

import crypto from 'node:crypto'

// ── Constants from extractor.js ──────────────────────────────────────
const Ce = [13, 27, 7, 19, 31, 11, 23, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151]
const ht = new Uint8Array(Array.from({ length: 32 }, ((_, t) => (t * 17 + 53 ^ t * 23 + 79 ^ t * 31 + 124) & 255)))
// Original: ((e => e * e * e)(6) + 47) * 60 * 1000 = (216 + 47) * 60000 = 15,780,000 ms
const WINDOW_MS = 263 * 60 * 1000 // 263 min = 15,780,000 ms (~4.4 hours)

// ── Helper functions ──────────────────────────────────────────────────
const Ie = (e, t, n) => ((e ^ t) << 1 ^ (t ^ n) >> 1 ^ e + t + n) & 255
const gt = (e, t) => e[t % e.length] ^ e[(t * 7 + 11) % e.length] ^ e[(t * 13 + 17) % e.length]

function ot(encoded) {
  let str = encoded
  while (str.length % 4) str += '='
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function tr(e, t) {
  const n = new Uint8Array(e.length)
  for (let r = 0; r < e.length; r++) {
    const a = r % t.length
    const c = t[a]
    const l = (c << r % 8 | c >>> 8 - r % 8) & 255
    const i = r * 7 + 13 & 255
    n[r] = (e[r] ^ l ^ i ^ t[(a + 1) % t.length]) & 255
  }
  return n
}

// ── Key derivation ────────────────────────────────────────────────────
async function deriveKeys(timestamp) {
  const e = Math.floor(timestamp / WINDOW_MS)

  // 128-byte seed
  const t = new Uint8Array(128)
  for (let i = 0; i < 128; i++) {
    const u = Ce[i % Ce.length]
    t[i] = (gt(ht, i) ^ e + i * u & 255 ^ (i ^ u) & 255) & 255
  }

  // 64-byte intermediate
  const n = new Uint8Array(64)
  for (let i = 0; i < 64; i++) {
    const u = t[i], m = t[i + 64], d = Ie(u, m, e >>> i % 16 & 255)
    n[i] = (u ^ d) & 255
  }

  // 32-byte key material
  const r = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    const u = n[i], m = n[i + 32], d = Ce[(i * 3 + 7) % Ce.length]
    r[i] = (u ^ m ^ u + m + d & 255) & 255
  }

  // 16-byte XOR key
  const a = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    const u = r[i], m = r[i + 16], d = (((u << 3 | u >>> 5) ^ (m << 5 | m >>> 3)) & 255)
    a[i] = (d ^ e >>> i * 2 & 255) & 255
  }

  // 48-byte mixing layer
  const c = new Uint8Array(48)
  for (let i = 0; i < 48; i++) {
    const u = (i * 7 + 11) % 32, m = (i * 13 + 17) % 32, d = (i * 19 + 23) % 32
    const p = Ie(r[u], r[m], r[d])
    c[i] = (p ^ e >>> i % 24 & 255 ^ gt(ht, i * 3)) & 255
  }

  // Final 32-byte AES key
  const l = new Uint8Array(32)
  for (let i = 0; i < 3; i++) {
    for (let u = 0; u < 32; u++) {
      const m = i === 0 ? c[u] : l[u]
      const d = c[(u * 5 + 7) % 48]
      const p = c[(u * 11 + 13) % 48]
      const g = Ie(m, d, p)
      l[u] = (g ^ c[(u + i * 16) % 48]) & 255
    }
  }

  // Node.js crypto.subtle equivalent
  const aesKey = await crypto.subtle.importKey(
    'raw', l,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )

  return { aesKey, xorKey: a }
}

// ── Master decrypt function ───────────────────────────────────────────
/**
 * Decrypt an encrypted anidap source response.
 *
 * @param {string} encryptedData - The base64url-encoded encrypted string
 *   from the old anidap API (the `data` field).
 * @returns {Promise<object>} Parsed JSON with sources, tracks, headers, etc.
 */
export async function decryptSource(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new Error('No encrypted data provided')
  }

  // Try current time window, fall back to previous window on failure.
  for (const ts of [Date.now(), Date.now() - WINDOW_MS]) {
    try {
      const { aesKey, xorKey } = await deriveKeys(ts)
      const decoded = ot(encryptedData)
      const iv = new Uint8Array(decoded.slice(0, 12))
      const ciphertext = new Uint8Array(decoded.slice(12))

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        ciphertext,
      )

      const finalData = tr(new Uint8Array(decrypted), xorKey)
      const json = new TextDecoder().decode(finalData)
      return JSON.parse(json)
    } catch {
      // Try previous window
      continue
    }
  }

  throw new Error('Decryption failed for both current and previous time windows')
}
