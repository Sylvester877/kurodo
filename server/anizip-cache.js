// Shared AniZip mapping cache — the ONE place the whole app resolves
// MAL/AniList ids → AniZip episode mappings.
//
// Why this exists (root fix for slow episode fetching):
//   - Before, every episode surface fetched https://api.ani.zip/mappings
//     independently with its own axios call + its own in-memory cache:
//     the client episode list, /api/anikage-episodes, TVDB's series-id
//     resolution and /api/episode-thumbs each fired the SAME mapping
//     upstream — a cold page could pay 2-3 duplicate ~1-4s round-trips,
//     and a server restart threw every cache away.
//   - Now: one memory cache (6h) + one disk cache (<tmp>/kurodo-anizip,
//     14d, survives restarts) + single-flight (concurrent lookups share
//     one upstream promise). Every lookup in the process — and across
//     restarts — resolves from the same store, so the mapping is fetched
//     upstream exactly once per anime ever.
//
// Pattern: server/index.js /img disk cache (imgDiskRead/imgDiskWrite).
import axios from 'axios'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const UPSTREAM = 'https://api.ani.zip/mappings'

// ── Cache tiers ───────────────────────────────────────────────────
const mem = new Map()                          // key → { at, data } (positive only)
const MEM_TTL = 6 * 60 * 60 * 1000             // 6h in-memory
const DISK_DIR = process.env.KURODO_ANIZIP_CACHE_DIR || path.join(os.tmpdir(), 'kurodo-anizip')
const DISK_TTL = 14 * 24 * 60 * 60 * 1000      // 14d — mappings are effectively immutable
const DISK_MAX_BYTES = 200 * 1024 * 1024       // 200MB cap (~a few thousand long shows)
const NEG_TTL = 45 * 1000                      // transient upstream failure: don't hammer, don't persist
const inflight = new Map()                     // key → Promise (single-flight)

export function cacheKey(malId, anilistId) {
  if (malId) return `mal:${Number(malId)}`
  if (anilistId) return `al:${Number(anilistId)}`
  throw new Error('anizip-cache: need mal_id or anilist_id')
}

function ensureDiskDir() {
  try { fs.mkdirSync(DISK_DIR, { recursive: true }) } catch { /* read-only env — memory-only */ }
}

function diskPaths(key) {
  const h = crypto.createHash('sha1').update(key).digest('hex')
  return path.join(DISK_DIR, h + '.json')
}

/** Read + validate a disk-cached mapping. Null on miss / stale / corrupt. */
function diskRead(key) {
  try {
    const p = diskPaths(key)
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (!raw || typeof raw.data !== 'object' || raw.data === null) return null
    if (Date.now() - raw.at > DISK_TTL) return null
    return raw.data
  } catch { return null }
}

/** Fire-and-forget disk write; prunes oldest files when over the byte cap. */
function diskWrite(key, data) {
  try {
    ensureDiskDir()
    const p = diskPaths(key)
    fs.writeFileSync(p, JSON.stringify({ at: Date.now(), data }))
    // Prune when over budget — cheap sweep on writes only.
    let total = 0
    let files = []
    for (const f of fs.readdirSync(DISK_DIR)) {
      const fp = path.join(DISK_DIR, f)
      try {
        const s = fs.statSync(fp)
        files.push({ p: fp, mtime: s.mtimeMs, size: s.size })
        total += s.size
      } catch { /* raced delete */ }
    }
    if (total > DISK_MAX_BYTES) {
      files.sort((a, b) => a.mtime - b.mtime)
      for (const f of files) {
        if (total <= DISK_MAX_BYTES * 0.85) break
        try { fs.unlinkSync(f.p); total -= f.size } catch { /* ignore */ }
      }
    }
  } catch { /* disk full / locked — memory cache still serves */ }
}

/**
 * Resolve an AniZip mapping for a MAL id or an AniList id.
 * Returns the raw mapping object ({ episodes, mappings, tvdbShowId, ... })
 * or null when the lookup genuinely failed. Never throws.
 */
export async function getAnizipMapping({ malId, anilistId } = {}) {
  const key = cacheKey(malId, anilistId)

  // 1. In-memory cache (transient failures get a short negative TTL so a
  //    dead upstream can't lock an anime out for the full MEM_TTL)
  const hit = mem.get(key)
  if (hit) {
    const ttl = hit.negative ? NEG_TTL : MEM_TTL
    if (Date.now() - hit.at < ttl) return hit.data
  }

  // 2. Disk cache (survives restarts — the "cold boot" killer)
  const disk = diskRead(key)
  if (disk) {
    mem.set(key, { at: Date.now(), data: disk })
    return disk
  }

  // 3. Single-flight: concurrent callers (client list + anikage enrichment
  //    + TVDB series-id + episode-thumbs) share ONE upstream request.
  const existing = inflight.get(key)
  if (existing) return existing

  const params = malId ? { mal_id: malId } : { anilist_id: anilistId }
  const promise = (async () => {
    try {
      const r = await axios.get(UPSTREAM, {
        params,
        timeout: 15_000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36' },
        validateStatus: (s) => s >= 200 && s < 300,
      })
      const data = r?.data
      if (!data || typeof data !== 'object' || !data.episodes) {
        // Upstream answered but with junk — treat as a soft failure, cache
        // nothing positive. An invalid id can legitimately map to empty
        // episodes, so the caller decides how to handle a null mapping.
        mem.set(key, { at: Date.now(), data: null, negative: true })
        return null
      }
      mem.set(key, { at: Date.now(), data })
      diskWrite(key, data)
      return data
    } catch (e) {
      // Transient failure — remember briefly so a burst of page loads
      // doesn't fire N upstream requests for the same dead lookup, but
      // never persist negatives (they go stale when upstream recovers).
      mem.set(key, { at: Date.now(), data: null, negative: true })
      console.warn(`[anizip-cache] mapping fetch failed (${params.mal_id ? 'mal:' + params.mal_id : 'al:' + params.anilistId}):`, e?.message || e)
      return null
    }
  })()

  inflight.set(key, promise)
  try {
    return await promise
  } finally {
    inflight.delete(key)
  }
}

/** Exposed for diagnostics/tests. */
export function getAnizipCacheStatus() {
  return { memEntries: mem.size, inflight: inflight.size, diskDir: DISK_DIR }
}

/** Prune stale memory entries (called on writes, capped). */
function pruneMem() {
  if (mem.size <= 400) return
  const n = Date.now()
  for (const [k, v] of mem) if (n - v.at > MEM_TTL) mem.delete(k)
}

/** HTTP route: GET /api/anizip/mapping?mal_id=123 | ?anilist_id=456 */
export function register(app) {
  app.get('/api/anizip/mapping', async (req, res) => {
    const malId = Number(req.query.mal_id)
    const anilistId = Number(req.query.anilist_id)
    const hasMal = Number.isFinite(malId) && malId > 0
    const hasAl = Number.isFinite(anilistId) && anilistId > 0
    if (!hasMal && !hasAl) {
      return res.status(400).json({ ok: false, error: 'Need mal_id or anilist_id' })
    }
    try {
      const data = await getAnizipMapping(hasMal ? { malId } : { anilistId })
      pruneMem()
      if (!data) return res.status(502).json({ ok: false, error: 'AniZip mapping unavailable', retryable: true })
      return res.json({ ok: true, data })
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'unknown' })
    }
  })
}
