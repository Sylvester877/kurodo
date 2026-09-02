// megavid provider — root fix for chad IP rate-limiting.
//
// megavid.buzz exposes a MAL-keyed stream API that needs NO browser, NO
// chad, and NO slug resolution:
//
//   GET https://megavid.buzz/mal/<malId>/<ep>/<sub|dub>/source
//   Referer: https://megavid.buzz/        (gate: "Embed Only" 403 without it)
//   → { status: 'ok', source: 'https://cp.megavid.buzz/hls/<uuid>/playlist.m3u8',
//       tracks: [{ file, label, kind, srclang }, ...] }
//
// Verified Sep 2026 (FMAB = MAL 5114, sub + dub; Liar Game = 62331):
//   • source API returns 200 JSON in ~1-2s with just a Referer header
//   • the cp.megavid.buzz HLS CDN is fully OPEN (no Referer/token needed)
//     and serves a multi-variant master playlist + VTT caption tracks
//   • MAL-keyed → covers old shows the gogoanime mirror doesn't host
//
// This provider is the first-resort fast path in routedGetStream: it
// resolves in ~2s and is immune to chad's IP rate-limit window entirely.

import axios from 'axios'
import http from 'node:http'
import https from 'node:https'
import { fetchAnimeTitles } from './title-resolver.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const BASE = 'https://megavid.buzz'

const client = axios.create({
  timeout: 12_000,
  headers: { 'User-Agent': UA, Referer: `${BASE}/`, Accept: 'application/json' },
  validateStatus: () => true,
  // Keep-alive agents: repeat source fetches reuse the TLS session (~2s
  // instead of ~10s cold). IPv4-first avoids long IPv6 fallback delays on
  // hosts with unreachable AAAA records.
  httpAgent: new http.Agent({ keepAlive: true, family: 4 }),
  httpsAgent: new https.Agent({ keepAlive: true, family: 4 }),
})

// malId → { at, titles } — avoid re-hitting AniList for the same show.
const titleCache = new Map()
const TITLE_TTL = 6 * 60 * 60 * 1000

// (malId, ep, type) → { at, data } positive cache. Stream URLs are per-ep HLS
// playlists; the CDN accepts range requests, so a short cache is safe and
// makes a re-click of the same episode instant.
const streamCache = new Map()
const STREAM_TTL = 10 * 60 * 1000

// (malId, ep, type) → { at } negative cache — don't re-probe a miss for 5 min.
const missCache = new Map()
const MISS_TTL = 5 * 60 * 1000

function cacheGet(map, key, ttl) {
  const hit = map.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > ttl) {
    map.delete(key)
    return null
  }
  return hit
}

function prune(map, max = 300) {
  if (map.size <= max) return
  const now = Date.now()
  for (const [k, v] of map) if (now - v.at > 60 * 60 * 1000) map.delete(k)
}

async function resolveMalId(anilistId, title) {
  if (!anilistId && !title) return null
  const key = String(anilistId || title?.english || title?.romaji || '')
  const hit = cacheGet(titleCache, key, TITLE_TTL)
  if (hit) return hit.malId
  try {
    const { titles, malId } = await fetchAnimeTitles(anilistId)
    const entry = { at: Date.now(), malId, titles }
    titleCache.set(key, entry)
    prune(titleCache)
    return malId
  } catch {
    return null
  }
}

async function fetchSource(malId, ep, type) {
  const url = `${BASE}/mal/${malId}/${ep}/${type}/source`
  const res = await client.get(url)
  if (res.status !== 200) return null
  const data = typeof res.data === 'string' ? safeJson(res.data) : res.data
  const src = data?.source || data?.sourceUrl || data?.url
  if (!src || !/\.m3u8|\.mp4/i.test(src)) return null
  return {
    url: src,
    raw: src,
    headers: { Referer: `${BASE}/` },
    tracks: (Array.isArray(data.tracks) ? data.tracks : [])
      .filter((t) => t && (t.file || t.url))
      .map((t) => ({
        file: t.file || t.url,
        label: t.label || t.srclang || '',
        kind: t.kind || 'captions',
        default: /eng/i.test(t.srclang || t.label || '') && !/orig/i.test(t.label || ''),
      })),
  }
}

function safeJson(s) {
  try { return JSON.parse(s) } catch { return null }
}

export const megavidProvider = {
  name: 'megavid',

  /**
   * @param {number|null} anilistId
   * @param {number|string} ep episode number (1-based)
   * @param {'sub'|'dub'} type
   * @returns {Promise<{url, raw, headers, tracks}|null>}
   */
  async getStream(anilistId, ep, type = 'sub', title = null, opts = {}) {
    const epNum = Number(ep) || 1
    const t0 = Date.now()
    const malId = await resolveMalId(anilistId, title)
    console.log(`[megavid] resolveMalId(${anilistId}) -> ${malId} in ${Date.now() - t0}ms`)
    if (!malId) return null

    const cacheKey = `${malId}:${epNum}:${type}`
    const hit = cacheGet(streamCache, cacheKey, STREAM_TTL)
    if (hit) return hit.data

    const miss = cacheGet(missCache, cacheKey, MISS_TTL)
    if (miss) return null

    // Try sub/dub both ways if the requested type is missing — a show with
    // only a dub source is still better than "no stream".
    const order = type === 'dub' ? ['dub', 'sub'] : ['sub', 'dub']
    let sawDefinitiveMiss = false
    let lastErr = null
    for (const t of order) {
      if (opts.signal?.aborted) return null
      try {
        const tf = Date.now()
        const data = await fetchSource(malId, epNum, t)
        console.log(`[megavid] fetchSource ${malId} ep${epNum} ${t} -> ${data ? 'HIT' : 'miss'} in ${Date.now() - tf}ms`)
        if (data) {
          const wrapped = { ...data, requestedType: type, servedType: t }
          streamCache.set(cacheKey, { at: Date.now(), data: wrapped })
          prune(streamCache)
          console.log(`[megavid] ${malId} ep${epNum} ${t} OK (${t === type ? 'requested' : 'fallback'} type)`)
          return wrapped
        }
        // Definitive upstream answer (200 without a source, or 404): safe to
        // remember as a miss.
        sawDefinitiveMiss = true
      } catch (e) {
        if (e?.name === 'AbortError' || e?.code === 'ERR_CANCELED') return null
        lastErr = e
        console.warn(`[megavid] fetchSource ${malId} ep${epNum} ${t} threw in ${Date.now() - tf}ms: ${e?.message || e}`)
      }
    }

    // Only negative-cache DEFINITIVE misses. Network errors/timeouts must
    // NOT poison the cache — the next request should retry the fetch.
    if (sawDefinitiveMiss || !lastErr) {
      missCache.set(cacheKey, { at: Date.now() })
      prune(missCache)
    }
    return null
  },
}
