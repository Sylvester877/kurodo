// TVDB v4 KEY-ART resolver — clearlogo / background / banner per anime.
//
// anikage.cc serves its hero art DIRECTLY from artworks.thetvdb.com:
//   .../v4/series/{id}/backgrounds/{hash}.jpg  (hero backdrop)
//   .../v4/series/{id}/clearlogo/{hash}.png    (transparent wordmark logo)
// Zero TMDB search, zero per-title guessing — TVDB has canonical key art.
//
// Resolution chain (mirrors tvdb-episodes.js):
//   MAL/AniList id → AniZip mapping (tvdbShowId, shared cache) → TVDB v4
//   login (shared token) → /series/{id}/extended (artworks array).
//
// Caching: memory 24h + disk 30d (artwork is effectively immutable) +
// single-flight. Negative lookups live 10 MINUTES in memory only — a show
// that has no TVDB entry today may gain one (same policy as the TMDB logo
// NEG_TTL), but we still avoid hammering upstream during a burst.
import axios from 'axios'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { getAnizipMapping } from './anizip-cache.js'

const API_BASE = 'https://api4.thetvdb.com/v4'

// ── Cache tiers ──────────────────────────────────────────────────
const MEM_TTL = 24 * 60 * 60 * 1000        // 24h positive
const NEG_TTL = 10 * 60 * 1000             // 10m negative (memory only)
const DISK_TTL = 30 * 24 * 60 * 60 * 1000  // 30d on disk
const DISK_DIR = process.env.KURODO_TVDB_CACHE_DIR || path.join(os.tmpdir(), 'kurodo-tvdb')

const mem = new Map() // key → { at, data, negative? }
const inflight = new Map()

function diskPaths(key) {
  const h = crypto.createHash('sha1').update(key).digest('hex')
  return path.join(DISK_DIR, 'art-' + h + '.json')
}

function diskRead(key) {
  try {
    const raw = JSON.parse(fs.readFileSync(diskPaths(key), 'utf-8'))
    if (!raw || Date.now() - raw.at > DISK_TTL) return null
    return raw.data || null
  } catch { return null }
}

function diskWrite(key, data) {
  try {
    fs.mkdirSync(DISK_DIR, { recursive: true })
    fs.writeFileSync(diskPaths(key), JSON.stringify({ at: Date.now(), data }))
  } catch { /* best effort */ }
}

// ── TVDB token — reuse the login machinery from tvdb-episodes.js. That
// module keeps its token private, so we re-login here ONLY if episodes
// hasn't already warmed one; in practice both share the same 24h session
// cost once per boot. To avoid a duplicate login we import nothing and
// instead piggyback: extended artwork requests accept 401 → retry once.
let token = null
let tokenAt = 0
const TOKEN_TTL = 24 * 60 * 60 * 1000
let loginInFlight = null

const getApiKey = () => (process.env.TVDB_API_KEY || '').trim()

async function getToken() {
  if (token && Date.now() - tokenAt < TOKEN_TTL) return token
  if (!getApiKey()) return null
  if (loginInFlight) return loginInFlight
  loginInFlight = (async () => {
    try {
      const { data } = await axios.post(
        `${API_BASE}/login`,
        { apikey: getApiKey() },
        { timeout: 15_000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36' } },
      )
      token = data?.data?.token || null
      tokenAt = Date.now()
      return token
    } catch {
      return null
    } finally {
      loginInFlight = null
    }
  })()
  return loginInFlight
}

/**
 * Warm the TVDB token + an example artwork lookup at boot. Never throws.
 * (Complements warmTvdbToken() from tvdb-episodes.js — same session.)
 */
export async function warmTvdbArt() {
  if (!getApiKey()) return
  try { await getToken() } catch { /* first real request retries */ }
}

// ── Artwork classification ──────────────────────────────────────
// TVDB v4 artworkType ids: 1=Banner, 2=Poster, 3=Background, 4=Logo (and
// newer "textless" variants share the same ids with tagOptions). We classify
// by type id FIRST, then by the URL path shape as a fallback (the CDN paths
// are stable: /clearlogo/, /backgrounds/, /banners/).
function classify(artwork) {
  const url = artwork?.image || ''
  const t = Number(artwork?.type) || 0
  if (t === 4 || /\/clearlogo\//.test(url)) return 'clearlogo'
  if (t === 3 || /\/backgrounds\//.test(url)) return 'background'
  if (t === 1 || /\/banners\//.test(url)) return 'banner'
  if (t === 2 || /\/posters\//.test(url)) return 'poster'
  return null
}

/**
 * Pick the best artwork per category from a TVDB extended artworks array.
 * Preference: eng language → higher score → larger width.
 */
function pickArt(artworks) {
  const out = { clearlogo: null, background: null, banner: null, poster: null }
  if (!Array.isArray(artworks)) return out
  const best = (list) => {
    if (!list.length) return null
    const score = (a) => {
      const lang = a.language === 'eng' ? 2 : a.language == null ? 1 : 0
      return lang * 10_000 + (Number(a.score) || 0) * 100 + (Number(a.width) || 0) / 10
    }
    return list.reduce((a, b) => (score(a) >= score(b) ? a : b)).image || null
  }
  const buckets = { clearlogo: [], background: [], banner: [], poster: [] }
  for (const a of artworks) {
    const kind = classify(a)
    if (kind && a.image) buckets[kind].push(a)
  }
  out.clearlogo = best(buckets.clearlogo)
  out.background = best(buckets.background)
  out.banner = best(buckets.banner)
  out.poster = best(buckets.poster)
  return out
}

/**
 * Resolve TVDB key art for an anime.
 * @returns {{ tvdbId:number|null, clearlogo:string|null, background:string|null,
 *             banner:string|null, poster:string|null } | null}
 *  null = no TVDB entry (or transient upstream failure — not cached on disk).
 */
export async function getTvdbArt({ malId, anilistId } = {}) {
  if (!malId && !anilistId) return null
  const key = malId ? `mal:${malId}` : `al:${anilistId}`

  // 1. Memory (positive or short negative)
  const hit = mem.get(key)
  if (hit) {
    const ttl = hit.negative ? NEG_TTL : MEM_TTL
    if (Date.now() - hit.at < ttl) return hit.data
  }

  // 2. Disk (positive only)
  const disk = diskRead(key)
  if (disk) {
    mem.set(key, { at: Date.now(), data: disk })
    return disk
  }

  // 3. Single-flight
  const existing = inflight.get(key)
  if (existing) return existing

  const promise = (async () => {
    // AniZip mapping — shared cache with tvdb-episodes/anikage-episodes so
    // this never pays a duplicate upstream round-trip.
    const mapping = await getAnizipMapping({ malId, anilistId }).catch(() => null)
    const tvdbId = mapping?.tvdbShowId || mapping?.mappings?.thetvdb_id || null
    if (!tvdbId) {
      // Not transient-safe to distinguish; short negative in memory only.
      const neg = { tvdbId: null, clearlogo: null, background: null, banner: null, poster: null }
      mem.set(key, { at: Date.now(), data: neg, negative: true })
      return neg
    }

    const tok = await getToken()
    if (!tok) {
      // No API key / login failed — treat like a short negative; a key can
      // be added at runtime so we must not lock the door for 24h.
      const neg = { tvdbId: null, clearlogo: null, background: null, banner: null, poster: null }
      mem.set(key, { at: Date.now(), data: neg, negative: true })
      return neg
    }

    try {
      // `meta=artworks` is lighter than meta=episodes (no per-episode fetch).
      const { data } = await axios.get(
        `${API_BASE}/series/${tvdbId}/extended?meta=artworks`,
        {
          timeout: 12_000,
          headers: {
            Authorization: `Bearer ${tok}`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36',
          },
          validateStatus: (s) => s >= 200 && s < 300,
        },
      )
      const art = pickArt(data?.data?.artworks)
      const result = { tvdbId, ...art }
      mem.set(key, { at: Date.now(), data: result })
      if (result.clearlogo || result.background || result.banner) diskWrite(key, result)
      return result
    } catch (e) {
      // 401 → token went stale mid-flight; drop it so the next call re-logins.
      if (e?.response?.status === 401) { token = null; tokenAt = 0 }
      // Transient failure — short negative, retryable, nothing persisted.
      const neg = { tvdbId: null, clearlogo: null, background: null, banner: null, poster: null }
      mem.set(key, { at: Date.now(), data: neg, negative: true })
      console.warn('[tvdb-art] extended fetch failed:', e?.message || e)
      return neg
    }
  })()

  inflight.set(key, promise)
  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

/** Diagnostics for /api/health. */
export function getTvdbArtStatus() {
  return {
    memEntries: mem.size,
    inflight: inflight.size,
    tokenReady: !!(token && Date.now() - tokenAt < TOKEN_TTL),
    keyConfigured: !!getApiKey(),
  }
}
