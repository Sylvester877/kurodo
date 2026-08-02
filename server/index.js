// Express backend: anidap scraper API + HLS manifest proxy + static frontend.
//
// Single-server architecture — one process serves everything:
//   npm run build   (build the React PWA once)
//   npm run dev     (build + start → one server on port 5173)
//   npm start       (start without rebuilding)
//
// This single process serves:
//   1. The built React PWA (dist/) with SPA routing
//   2. The scraper API (/api/anidap/*, /api/filler, /api/diag, /api/health)
//   3. The HLS proxy (/proxy) for CORS-free streaming
//   4. The image proxy (/img) with fallback chain + negative cache
//   5. AniList OAuth token exchange (/api/anilist/exchange)

import express from 'express'
import cors from 'cors'
import axios from 'axios'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

// Read the app version from package.json at startup (not hardcoded) so the
// health endpoint and diagnostics always report the true installed version.
let APP_VERSION = '0.0.0'
try {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'))
  APP_VERSION = pkg.version || APP_VERSION
} catch { /* fall back to 0.0.0 if package.json is unreachable */ }

// Must be defined BEFORE the dotenv block — ESM const declarations are NOT
// hoisted, so using __dirname in a top-level await before this line would
// throw ReferenceError (TDZ), silently caught, and .env.local never loads.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env / .env.local so server env vars like ANIWATCH_DOMAIN take effect.
// (Vite handles its own VITE_* env vars; this is just for Node-side config.)
// Defensive: if dotenv isn't installed yet, the backend still boots — the
// app just runs with whatever env vars the shell already provides.
try {
  const dotenv = (await import('dotenv')).default
  // Resolve .env.local relative to this file (server/index.js) so it works
  // regardless of CWD — critical for the packaged Electron app where CWD
  // is the install directory, not the project root.
  const envLocal = path.resolve(__dirname, '..', '.env.local')
  dotenv.config({ path: envLocal, override: false })
  dotenv.config()  // default .env as fallback
  console.log('[backend] Loaded .env.local from:', envLocal)
} catch {
  console.warn('[backend] dotenv not installed — skipping .env.local load.')
  console.warn('[backend] Run `npm install` if you want server-side env vars.')
}
import {
  routedGetInfo,
  routedGetEpisodes,
  routedGetProviders,
  routedGetStream,
} from './providers/router.js'
import {
  startHealthCheckScheduler,
  getHealthStats,
  getRecentHealthEntries,
} from './health-check.js'
import {
  searchManga,
  getMangaInfo,
  getChapterFeed,
  getChapterPages,
  getLatestManga,
  getMangaByTag,
  browseManga,
  GENRE_MAP,
  FORMAT_TAGS,
  SORT_ORDERS,
} from './providers/mangadex.js'
import {
  searchManga as searchMangaAtsu,
  getMangaInfo as getMangaInfoAtsu,
  getChapterFeed as getChapterFeedAtsu,
  getChapterPages as getChapterPagesAtsu,
} from './providers/atsu.js'
import { runDiagnostics } from './diag.js'
import {
  searchAniListAsJikan,
  getAniListAnimeByMalAsJikan,
  tryAniListFallback,
} from './jikan-fallback.js'

import {
  buildProxyConfig,
  shouldUseProxy,
  initGogoProxyPool,
} from './proxy-config.js'

// Keep-alive: reuse TCP connections, save 200-500ms per request
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 })
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 })

// Lazy-import cf-harvester shutdown so it doesn't launch Puppeteer on import
let _harvesterShutdown = null
async function getHarvesterShutdown() {
  if (_harvesterShutdown) return _harvesterShutdown
  const { shutdown } = await import('./cf-harvester.js')
  _harvesterShutdown = shutdown
  return shutdown
}

// Lazy-resolve ffmpeg binary path — prefers the bundled ffmpeg-static binary
// so downloads work in the packaged Electron app without system ffmpeg.
// Falls back to 'ffmpeg' on PATH if ffmpeg-static isn't installed.
let _ffmpegPath = null
async function getFfmpegPath() {
  if (_ffmpegPath) return _ffmpegPath
  try {
    const ffmpegStatic = await import('ffmpeg-static')
    _ffmpegPath = ffmpegStatic.default || ffmpegStatic
    console.log('[ffmpeg] Using bundled binary:', _ffmpegPath)
  } catch {
    _ffmpegPath = 'ffmpeg'
    console.warn('[ffmpeg] ffmpeg-static not available, falling back to system ffmpeg')
  }
  return _ffmpegPath
}
axios.defaults.httpAgent = httpAgent
axios.defaults.httpsAgent = httpsAgent

// Optional residential proxy for Cloudflare-blocked CDNs.
// See proxy-config.js for details, CDN host list, and bandwidth cost warning.
const RESIDENTIAL_PROXY = buildProxyConfig(process.env.RESIDENTIAL_PROXY_URL)
if (RESIDENTIAL_PROXY) {
  // PROXY_CDN_HOSTS is imported above, but we reference the static list directly
  // to avoid a circular import dance with proxy-config.js at top-level.
  console.log(`[proxy] Residential proxy active → ${RESIDENTIAL_PROXY.host}:${RESIDENTIAL_PROXY.port}`)
}

// Initialize the optional gogoanime proxy pool (GOGO_PROXIES env var or
// gogo-proxies.txt). This must happen before any gogoanime requests.
initGogoProxyPool()


/**
 * Convert SubRip (.srt) text to WebVTT. Both formats use the same cue
 * shape — the only differences are:
 *   - VTT timestamps use "." for milliseconds, SRT uses ","
 *   - VTT starts with "WEBVTT" header
 *   - VTT drops the cue index numbers
 */
function srtToVtt(srt) {
  let out = 'WEBVTT\n\n'
  const text = srt.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
  // Replace timestamp commas with dots
  out += text.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2',
  ).replace(
    // Strip leading cue indices like "1\n" before "00:00:..."
    /(^|\n)\d+\n(?=\d{2}:\d{2}:\d{2}[.,]\d{3})/g,
    '$1',
  )
  return out
}

const app = express()
const PORT = Number(process.env.PORT) || 5173

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

// ── Request timing / profiling middleware ───────────────────────────
// Logs every API request with its duration so we can spot slow upstream
// endpoints in production logs. Skips static assets to keep logs readable.
const SLOW_THRESHOLD_MS = 500
app.use((req, res, next) => {
  // Only profile API routes — skip static assets and the SPA fallback.
  if (!req.path.startsWith('/api/')) {
    return next()
  }
  const start = Date.now()
  const originalEnd = res.end
  res.end = function (...args) {
    res.end = originalEnd
    const duration = Date.now() - start
    const prefix = duration >= SLOW_THRESHOLD_MS ? '[SLOW]' : '[req]'
    console.log(`${prefix} ${req.method} ${req.path} → ${res.statusCode} in ${duration}ms`)
    return originalEnd.apply(this, args)
  }
  next()
})

// Gzip/brotli compression for all text responses.
// Reduces transfer size by 60-80% for HTML/CSS/JS/JSON.
try {
  const compression = (await import('compression')).default
  app.use(compression({ threshold: 512 }))
  console.log('[backend] Compression enabled (gzip/brotli)')
} catch {
  // compression package not installed — responses are still served uncompressed
  console.log('[backend] Compression not available — install with: npm install compression')
}



// ---------- Process-level safety nets — log crashes but DON'T kill the process ----------
// process.exit(1) would kill the entire Electron app on any unhandled error.
// Instead, log loudly so the issue is visible but the app stays alive.
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.stack || err.message || err)
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] unhandledRejection:', reason)
})

// Clean up Puppeteer browser on normal exit
process.on('SIGINT', async () => {
  console.log('\n[server] SIGINT — shutting down...')
  try { const s = await getHarvesterShutdown(); await s() } catch {}
  process.exit(0)
})
process.on('SIGTERM', async () => {
  console.log('\n[server] SIGTERM — shutting down...')
  try { const s = await getHarvesterShutdown(); await s() } catch {}
  process.exit(0)
})

// ---------- Tiny in-memory cache + negative-cache so we don't hammer anidap.se ----------
const cache = new Map()
const TTL = 10 * 60 * 1000  // 10min — info/episodes rarely change
// Negative cache: remember failures briefly so the page stops spinning when
// upstream returns 500 for a flaky title.
const failCache = new Map()
// 5 min — long enough to avoid hammering rate-limited upstreams,
// short enough that transient failures (network blips) recover quickly.
// Each repeated failure within the window doubles the TTL (exponential backoff).
const FAIL_TTL = 5 * 60 * 1000
const FAIL_BACKOFF_MAX = 10 * 60 * 1000  // 10 min cap
// Stream success cache: remember working stream URLs for 5min so repeat
// loads of the same episode+provider are instant (no browser bridge wait).
const streamCache = new Map()
const STREAM_CACHE_TTL = 5 * 60 * 1000  // 5min — streams are time-limited tokens
// Stream-level negative cache: remember per-episode+provider failures so
// the router doesn't retry the same dead provider 7+ times in one request.
const streamFailCache = new Map()
const STREAM_FAIL_TTL = 60 * 1000  // 1 min — long enough to stop retry storms, short enough to retry on fresh page load
// In-flight deduplication: two requests for the same key share one promise
// instead of hitting the upstream twice.
const inFlight = new Map()

const cached = async (key, ttl, fn, { timeoutMs = 15_000 } = {}) => {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value

  // If this key recently failed, throw immediately instead of waiting on a
  // long upstream timeout — the user can retry once it expires.
  const failed = failCache.get(key)
  if (failed && Date.now() - failed.at < FAIL_TTL) {
    const err = new Error(failed.message)
    err.response = { status: failed.upstream || 502 }
    err.cachedFailure = true
    throw err
  }

  // Deduplicate concurrent requests for the same key
  const existing = inFlight.get(key)
  if (existing) return existing

  const p = (async () => {
    try {
      // Hard timeout so the UI never spins forever on a stuck upstream.
      // Note: this rejects the promise but does NOT abort the underlying
      // work (Puppeteer/axios may keep running). That's acceptable because
      // the user gets a fast failure and the negative cache stops retries.
      const value = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => {
            const err = new Error(`Upstream timed out after ${timeoutMs}ms`)
            err.code = 'CACHED_TIMEOUT'
            reject(err)
          }, timeoutMs),
        ),
      ])
      cache.set(key, { at: Date.now(), value })
      return value
    } catch (e) {
      failCache.set(key, {
        at: Date.now(),
        message: e?.message || 'upstream error',
        upstream: e?.response?.status ?? null,
      })
      throw e
    } finally {
      inFlight.delete(key)
    }
  })()

  inFlight.set(key, p)
  return p
}

// Periodically prune stale entries from the generic cache and fail cache
// so they don't grow unbounded over the process lifetime.
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of cache) if (now - v.at > TTL) cache.delete(k)
  for (const [k, v] of failCache) if (now - v.at > FAIL_TTL) failCache.delete(k)
}, 60_000)

const ok = (res, data) => res.json({ ok: true, data })

/**
 * Forward an upstream error to the client with a useful message.
 * Routes through provider router throw with `.upstream` set; axios errors
 * have `.response.status`. We honor both.
 */
const fail = (res, err, code) => {
  const upstream = err?.upstream ?? err?.response?.status
  const status = code ?? upstream ?? 500
  // Preserve the router's "All scrapers failed: …" message — friendlyError
  // on the frontend renders it nicely.
  let msg = err?.message || String(err)

  // Only override the message for *bare* upstream-only failures, not for
  // the router's composite errors which already explain themselves.
  if (!err?.upstream) {
    if (upstream === 500) msg = 'The source returned a server error. Try again or pick a different anime.'
    else if (upstream === 403) msg = 'The source blocked the request. Anti-bot checks may have updated.'
    else if (upstream === 404) msg = 'Not found on the source.'
    else if (err?.code === 'ECONNABORTED') msg = 'Source timed out. Try again in a moment.'
  }

  console.error(`[anidap] ${status} ${err?.config?.url || ''} — ${msg}`)
  res.status(status).json({ ok: false, error: msg, upstream: upstream ?? null })
}

// ---------- Scraper endpoints (multi-provider with auto-failover) ----------
//
// The URL prefix stays `/api/anidap/*` for backward compatibility, but each
// endpoint now routes through the provider router which tries anidap first,
// then miruro/saturn/consumet if anidap fails. The frontend gets a `source` field telling
// it which scraper actually served the response.

// Resolve AniList ID → slug + metadata (any provider)
app.get('/api/anidap/info/:anilistId', async (req, res) => {
  try {
    const { anilistId } = req.params
    // 10s hard cap — info resolution can hang on slow upstreams
    const data = await cached(`info:${anilistId}`, TTL, () =>
      routedGetInfo(Number(anilistId)), { timeoutMs: 10_000 })
    ok(res, data)
  } catch (e) { fail(res, e) }
})

// Episode list for a slug. The slug is provider-specific; we also accept
// `?anilistId=` so the router can re-resolve if the slug doesn't match.
// Optional `?title_english=&title_romaji=` for hianime fallback search.
app.get('/api/anidap/episodes/:slug', async (req, res) => {
  try {
    const { slug } = req.params
    const anilistId = req.query.anilistId ? Number(req.query.anilistId) : null
    const title = { english: req.query.title_english, romaji: req.query.title_romaji }
    const cacheKey = `eps:${slug}:${anilistId || ''}:${title.english || ''}`
    // 10s hard cap — episode list scraping can hang on slow upstreams
    const data = await cached(cacheKey, TTL, () =>
      routedGetEpisodes(anilistId, slug, title), { timeoutMs: 10_000 })
    ok(res, data)
  } catch (e) { fail(res, e) }
})

// Provider list for one episode
//
// All servers always show — no health probes, no filtering, no hiding.
// Every server is marked _healthy: true so the frontend shows them all
// as clickable. The user decides which server to try.
app.get('/api/anidap/servers/:slug/:ep', async (req, res) => {
  try {
    const { slug, ep } = req.params
    const anilistId = req.query.anilistId ? Number(req.query.anilistId) : null
    const title = { english: req.query.title_english, romaji: req.query.title_romaji }
    const cacheKey = `srv:${slug}:${ep}:${anilistId || ''}:${title.english || ''}`
    // 8s hard cap — provider list is usually fast; don't let a dead upstream stall the UI
    const data = await cached(cacheKey, TTL, () =>
      routedGetProviders(anilistId, slug, Number(ep), title), { timeoutMs: 8_000 })
    // Annotate servers with health status but NEVER hide them.
    // The background health scheduler can produce false negatives when
    // anidap is rate-limited or Puppeteer is cold. Filtering dead servers
    // out entirely leaves users with an empty picker even though the
    // title is available. We keep every server clickable and just flag
    // the ones that recently failed probes. We use the fast server-level
    // health cache (getServerHealth) rather than per-episode probing so
    // this endpoint stays snappy.
    try {
      const { getServerHealth } = await import('./anidap.js')
      data.providers = data.providers.map((p) => {
        const health = getServerHealth(p.name, p.type)
        return {
          ...p,
          _healthy: health !== false,
          _healthMs: null,
          _healthError: health === false ? 'Server unreachable' : null,
        }
      })
    } catch {
      // If anidap.js can't be imported, just show all as healthy
      data.providers = data.providers.map((p) => ({
        ...p,
        _healthy: true,
        _healthMs: null,
        _healthError: null,
      }))
    }
    if (!Array.isArray(data.providers)) data.providers = []
    if (!data.unavailable) {
      try {
        const { isRateLimited, getRateLimitRemaining } = await import('./anidap.js')
        if (isRateLimited() && data.providers.length === 0) {
          data.unavailable = true
          data.reason = `rate-limited (${getRateLimitRemaining()}s)`
        }
      } catch {
        // ignore rate-limit probe failures
      }
    }
    ok(res, data)
  } catch (e) { fail(res, e) }
})

// Decrypted stream URL — cached for 5min per episode+provider so repeat
// loads are instant. Tokens are time-bound (typically 1-2h) so 5min is safe.
// Optional `?title_english=&title_romaji=` for hianime fallback search.
app.get('/api/anidap/sources/:slug/:ep/:provider/:type', async (req, res) => {
  const { slug, ep, provider, type } = req.params
  const anilistId = req.query.anilistId ? Number(req.query.anilistId) : null
  const title = { english: req.query.title_english, romaji: req.query.title_romaji }

  // Check stream-level negative cache first — fast-fail known-dead combos
  const streamKey = `${slug || anilistId || ''}:${ep}:${provider}:${type}`
  const streamFail = streamFailCache.get(streamKey)
  if (streamFail && Date.now() - streamFail.at < STREAM_FAIL_TTL) {
    const err = new Error(streamFail.message)
    err.response = { status: streamFail.upstream || 502 }
    err.cachedFailure = true
    return fail(res, err)
  }

  // ── Fast path: return cached stream URL if fresh ──
  const streamHit = streamCache.get(streamKey)
  if (streamHit && Date.now() - streamHit.at < STREAM_CACHE_TTL) {
    return ok(res, streamHit.data)
  }

  try {
    // 30s hard cap on stream extraction — the chad API is capped at 5s and
    // the DOM fallback needs up to 16s, so 20s was killing the request before
    // extraction could finish. 15s gives the chad API + DOM fallback room
    // to run while ensuring the UI never spins for more than ~15 seconds.
    const data = await Promise.race([
      routedGetStream(anilistId, slug, Number(ep), provider, type, req.query, title),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Stream extraction timed out')), 15_000),
      ),
    ])
    if (!data) {
      streamFailCache.set(streamKey, { at: Date.now(), message: 'No stream found', upstream: 404 })
      return fail(res, new Error('No stream found'), 404)
    }

    const primarySrc = data.raw || data.url || ''

    // Guard: if we got no URL at all, fail gracefully
    if (!primarySrc) {
      streamFailCache.set(streamKey, { at: Date.now(), message: 'Provider returned no stream URL', upstream: 404 })
      return fail(res, new Error('Provider returned no stream URL'), 404)
    }

    const hasHeaders = data.headers && Object.keys(data.headers).length > 0
    const hParam = hasHeaders
      ? '&h=' + encodeURIComponent(
          Buffer.from(JSON.stringify(data.headers)).toString('base64'),
        )
      : ''
    // Route streams through the proxy when:
    //   1. The CDN doesn't send CORS headers (needs proxy for browser access)
    //   2. The scraper provided upstream headers (Referer/Origin) that the
    //      CDN requires — even CORS-enabled CDNs like uwucdn.top may 403
    //      without the right Referer. The proxy injects those headers.
    // CORS CDNs with no header requirements (24stream.xyz) still bypass
    // the proxy to reduce server load.
    const useProxy = !isCorsCdn(primarySrc) || hasHeaders
    const proxied = useProxy
      ? `/proxy?url=${encodeURIComponent(primarySrc)}${hParam}`
      : primarySrc
    const fallbackProxied = (data.raw && data.url !== data.raw)
      ? (useProxy
          ? `/proxy?url=${encodeURIComponent(data.url)}${hParam}`
          : data.url)
      : null

    ok(res, {
      ...data,
      proxiedUrl: proxied,
      fallbackProxiedUrl: fallbackProxied,
    })

    // Cache the successful stream response for 5min
    streamCache.set(streamKey, {
      at: Date.now(),
      data: {
        ...data,
        proxiedUrl: proxied,
        fallbackProxiedUrl: fallbackProxied,
      },
    })
    // Prune old stream cache entries. If all 100+ are still fresh,
    // evict the oldest regardless of TTL (LRU hard cap).
    if (streamCache.size > 100) {
      const n = Date.now()
      for (const [k, v] of streamCache) if (n - v.at > STREAM_CACHE_TTL) streamCache.delete(k)
      if (streamCache.size > 100) {
        const oldest = streamCache.keys().next().value
        if (oldest !== undefined) streamCache.delete(oldest)
      }
    }
  } catch (e) {
    // Record failure in stream negative cache so the router doesn't retry
    const upstream = e?.response?.status || e?.upstream || 502
    if (!streamFailCache.has(streamKey)) {
      streamFailCache.set(streamKey, {
        at: Date.now(),
        message: e?.message || 'upstream failure',
        upstream,
      })
      // Prune old entries if the map gets large
      if (streamFailCache.size > 200) {
        const n = Date.now()
        for (const [k, v] of streamFailCache) if (n - v.at > STREAM_FAIL_TTL) streamFailCache.delete(k)
      }
    }
    fail(res, e)
  }
})

// Best-effort download links. Falls back to the stream m3u8 itself when
// chad's /rest/api/download is unavailable (Cloudflare 522/403 is common).
//
// As of Jun 2026, anidap is the only surviving provider; the download
// endpoint uses the old anidap.se API with AES-GCM decryption for
// stream retrieval when chad's download endpoint is unreachable.
app.get('/api/anidap/download/:slug/:ep/:provider/:type', async (req, res) => {
  try {
    const { slug, ep, provider, type } = req.params
    const { getDownload, getStream } = await import('./anidap.js')

    // ── ?convert=1 — skip native download, go straight to stream → ffmpeg ──
    const wantConvert = req.query.convert === '1'

    if (!wantConvert) {
      // Try chad's official download endpoint first.
      const dl = await getDownload(slug, Number(ep), provider, type)
      if (dl && dl.sources?.length) {
        // Wrap each source through our /proxy so the browser can save the
        // file without CORS preflight failures.
        const headerSuffix = dl.headers
          ? `&h=${encodeURIComponent(Buffer.from(JSON.stringify(dl.headers)).toString('base64'))}`
          : ''
        const wrapped = dl.sources.map((s) => ({
          ...s,
          proxiedUrl: `/proxy?url=${encodeURIComponent(s.url)}${headerSuffix}`,
        }))
        return ok(res, { kind: 'direct', sources: wrapped })
      }
    }

    // Fall back to the stream URL (m3u8) from anidap directly.
    // Strip provider prefix (e.g. "anidap-yuki" → "yuki") — the raw
    // getStream function expects bare provider names.
    const rawProvider = provider.replace(/^anidap-/, '')
    const dlAnilistId = req.query.anilistId ? Number(req.query.anilistId) : undefined
    let stream = null
    try {
      stream = await getStream(slug, Number(ep), rawProvider, type, dlAnilistId)
    } catch (anidapErr) {
      console.warn('[download] anidap stream failed:', anidapErr.message)
    }

    // Fall back through the router if direct call fails.
    if (!stream?.raw) {
      const anilistId = req.query.anilistId ? Number(req.query.anilistId) : null
      try {
        const routerStream = await routedGetStream(
          anilistId, slug, Number(ep), provider, type, {},
        )
        if (routerStream?.url || routerStream?.raw) {
          stream = {
            raw: routerStream.raw || routerStream.url,
            url: routerStream.url || routerStream.raw,
            headers: routerStream.headers || null,
          }
        }
      } catch (routerErr) {
        console.warn('[download] router fallback also failed:', routerErr.message)
      }
    }

    if (!stream?.raw) {
      return fail(res, new Error('No download link available for this episode.'), 404)
    }

    // ── ?convert=1 — server-side HLS→MP4 conversion via ffmpeg ──
    // Streams the converted MP4 directly to the browser as a download.
    // The user gets a one-click MP4 without needing local ffmpeg/yt-dlp.
    if (wantConvert) {
      const m3u8Url = stream.raw
      const fn = sanitizeDownloadFilename(slug, ep, provider, type)
      const referer = stream.headers?.Referer || stream.headers?.referer || ''
      const ua = stream.headers?.['User-Agent'] || stream.headers?.['user-agent'] ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

      console.log(`[download] ffmpeg convert: ${fn}`)

      const ffArgs = [
        '-headers', `Referer: ${referer}\r\nUser-Agent: ${ua}\r\n`,
        '-i', m3u8Url,
        '-c', 'copy',
        '-bsf:a', 'aac_adtstoasc',
        '-movflags', 'frag_keyframe+empty_moov',
        '-f', 'mp4',
        'pipe:1',
      ]

      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Content-Disposition', `attachment; filename="${fn}.mp4"`)

      const ffmpegPath = await getFfmpegPath()
      const ffmpeg = spawn(ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] })

      ffmpeg.stdout.pipe(res)

      ffmpeg.stderr.on('data', (d) => {
        // ffmpeg writes progress to stderr — log only on error
      })

      ffmpeg.on('error', (err) => {
        console.error('[download] ffmpeg spawn error:', err.message)
        if (!res.headersSent) res.status(500).json({ ok: false, error: 'ffmpeg failed to start' })
      })

      ffmpeg.on('close', (code) => {
        if (code !== 0 && !res.writableEnded) {
          console.error('[download] ffmpeg exited with code', code)
        }
      })

      req.on('close', () => {
        if (ffmpeg.exitCode === null && !ffmpeg.killed) ffmpeg.kill()
      })

      return
    }

    const headerSuffix = stream.headers
      ? `&h=${encodeURIComponent(Buffer.from(JSON.stringify(stream.headers)).toString('base64'))}`
      : ''
    return ok(res, {
      kind: 'hls',
      m3u8Url: stream.raw,
      proxiedUrl: `/proxy?url=${encodeURIComponent(stream.raw)}${headerSuffix}`,
      headers: stream.headers ?? null,
    })
  } catch (e) { fail(res, e) }
})

// Server probe — parallel-probes all available servers for an episode
// and reports which ones return playable streams. Used by the smoke test
// and the in-app Health page.
// GET /api/anidap/probe/:slug/:ep?anilistId=N&max=8
app.get('/api/anidap/probe/:slug/:ep', async (req, res) => {
  try {
    const { slug, ep } = req.params
    const anilistId = req.query.anilistId ? Number(req.query.anilistId) : null
    const maxProbes = Math.min(Number(req.query.max) || 8, 20)

    const { providers } = await routedGetProviders(anilistId, slug, Number(ep))
    if (!providers.length) {
      return ok(res, { results: [], working: [] })
    }

    const toProbe = providers.slice(0, maxProbes)
    const settled = await Promise.allSettled(
      toProbe.map(async (p) => {
        const start = Date.now()
        try {
          // Cap each probe at 8s so the whole probe batch doesn't hang forever.
          const stream = await Promise.race([
            routedGetStream(anilistId, slug, Number(ep), p.name, p.type, {}),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Probe stream extraction timed out')), 8_000),
            ),
          ])
          const ms = Date.now() - start
          return { name: p.name, type: p.type, ok: !!stream?.url, ms }
        } catch (e) {
          const ms = Date.now() - start
          return { name: p.name, type: p.type, ok: false, ms,
                   error: (e?.message || String(e)).slice(0, 120) }
        }
      }),
    )

    const results = settled.map((s) =>
      s.status === 'fulfilled'
        ? s.value
        : { name: '?', type: '?', ok: false, ms: 0, error: String(s.reason).slice(0, 120) },
    )
    const working = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)

    ok(res, { results, working })
  } catch (e) {
    fail(res, e)
  }
})

// ── Discovery: Recent episodes with filter tabs ──────────────────────
// Combines AniList airing schedule data with stream-cache availability
// so the frontend can filter by sub/dub/trending/random.
// GET /api/discover/recent?filter=all|sub|dub|trending|random&limit=18
app.get('/api/discover/recent', async (req, res) => {
  try {
    const filter = req.query.filter || 'all'
    const limit = Math.min(Number(req.query.limit) || 18, 30)
    const nowSec = Math.floor(Date.now() / 1000)
    const sevenDaysAgo = nowSec - 7 * 86400
    const cacheKey = `discover:recent:${filter}:${limit}`

    // Short TTL (2 min) so the feed feels live but doesn't hammer AniList.
    const data = await cached(cacheKey, 2 * 60 * 1000, async () => {
      const MEDIA_FIELDS = `
        id idMal
        title { romaji english native }
        coverImage { extraLarge large color }
        bannerImage
        episodes duration averageScore popularity format status season seasonYear genres
        studios(isMain: true) { nodes { name } }
        nextAiringEpisode { episode airingAt }
        description(asHtml: false)
      `

      const gql = `query ($from: Int, $to: Int, $perPage: Int) {
        Page(page: 1, perPage: $perPage) {
          airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME_DESC) {
            episode airingAt
            media { ${MEDIA_FIELDS} }
          }
        }
      }`

      const { data: alData } = await axios.post('https://graphql.anilist.co',
        { query: gql, variables: { from: sevenDaysAgo, to: nowSec, perPage: 50 } },
        { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 10_000 }
      )

      const items = alData?.data?.Page?.airingSchedules || []

      // Dedupe: one entry per show (latest episode).
      // Build a lookup map from stream cache for real dub availability.
      // Stream cache key format: `${slug || anilistId}:${ep}:${provider}:${type}`
      // Common case: numeric slug (from getInfoByAniListId) → parts[0] is the anime ID.
      // Build once, O(n) on cache entries, not O(n²) per episode.
      const dubById = new Map() // animeId → Set of episode numbers
      const now = Date.now()
      for (const [key, value] of streamCache) {
        if (now - value.at > STREAM_CACHE_TTL) continue
        const parts = key.split(':')
        // parts: [slugOrId, ep, provider, type]
        // Only match numeric slugs — non-numeric slugs like "one-piece" can't be mapped
        const animeId = Number(parts[0])
        if (!animeId || isNaN(animeId)) continue
        const epNum = Number(parts[1])
        if (!epNum || isNaN(epNum)) continue
        if (parts[3] === 'dub') {
          let eps = dubById.get(animeId)
          if (!eps) { eps = new Set(); dubById.set(animeId, eps) }
          eps.add(epNum)
        }
      }

      const seen = new Set()
      const episodes = []
      for (const item of items) {
        if (!item.media || seen.has(item.media.id)) continue
        seen.add(item.media.id)

        // Check real dub availability from stream cache.
        // Check both idMal (MAL ID) and AniList id — cache keys can contain either.
        const malId = item.media.idMal
        const alId = item.media.id
        const dubEps = (malId && dubById.get(malId)) || (alId && dubById.get(alId))
        const hasDub = dubEps ? dubEps.has(item.episode) : null

        episodes.push({
          episode: item.episode,
          airedAt: item.airingAt,
          media: item.media,
          // Real availability from stream cache (null = unknown, true = confirmed dub)
          hasDub,
          // Heuristic fallback: English title = likely dubbed
          likelyDub: !!item.media.title.english,
          likelySub: true,
        })
        if (episodes.length >= limit * 3) break
      }

      return { episodes, total: episodes.length }
    }, { timeoutMs: 12_000 })

    // Apply server-side filter
    let episodes = data.episodes
    if (filter === 'dub') {
      // Show episodes that are CONFIRMED dub from stream cache, OR likely dub (English title).
      // Unknown (null) with English title passes via likelyDub fallback.
      episodes = episodes.filter(e => e.hasDub === true || (e.hasDub === null && e.likelyDub))
    } else if (filter === 'sub') {
      // Sub is universal baseline — show all
    } else if (filter === 'trending') {
      episodes = [...episodes].sort((a, b) => (b.media.popularity || 0) - (a.media.popularity || 0))
    } else if (filter === 'random') {
      episodes = [...episodes]
      for (let i = episodes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [episodes[i], episodes[j]] = [episodes[j], episodes[i]]
      }
    }

    ok(res, { episodes: episodes.slice(0, limit), filter })
  } catch (e) {
    fail(res, e)
  }
})

// ────────── TMDB episode stills (real per-episode thumbnails) ─────────
// AniZip only ships episode screenshots for a handful of episodes of long
// shows (Bleach: 21/366) and Jikan's episodes endpoint carries no images.
// TMDB has a real still for EVERY episode (e.g. Bleach 366/366) and its
// season endpoint returns them all in one request. The API key lives in
// .env.local (server-side only — never in the client bundle or repo).
//
//   GET /api/episode-thumbs/:malId → { eps: { "1": "https://image.tmdb.org/t/p/w500/x.jpg", … } }
//
// Resolution chain: AniZip mapping → themoviedb_id → TMDB /tv/{id}/season/N.
// Seasons 1-4 are merged by running episode count (handles multi-season
// TMDB entries where episode numbers restart per season). Cached 24h.
// TMDB key lookup order: explicit server var → VITE_ var (Vite embeds it
// in the client bundle and dotenv loads it here too in dev) → empty. In
// packaged builds electron/main.js pre-loads .env.local from resources/
// into process.env before importing this module, so TMDB_API_KEY is set.
const TMDB_API_KEY = (process.env.TMDB_API_KEY || process.env.VITE_TMDB_API_KEY || '').trim()
const tmdbThumbCache = new Map() // malId → { at, eps }
const TMDB_THUMB_TTL = 24 * 60 * 60 * 1000
const TMDB_EMPTY_TTL = 60 * 60 * 1000 // short TTL for no-mapping results
const tmdbIdCache = new Map() // malId → { at, id } (from AniZip)
const TMDB_ID_TTL = 24 * 60 * 60 * 1000

async function getTmdbIdFromMal(malId) {
  const hit = tmdbIdCache.get(malId)
  if (hit && Date.now() - hit.at < TMDB_ID_TTL) return hit.id
  try {
    const r = await axios.get(`https://api.ani.zip/mappings?mal_id=${malId}`, {
      timeout: 10_000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      validateStatus: (s) => s >= 200 && s < 300,
    })
    const id = r.data?.mappings?.themoviedb_id || null
    tmdbIdCache.set(malId, { at: Date.now(), id })
    return id
  } catch {
    return null
  }
}

/** Fetch TMDB stills for all episodes of an anime (seasons 1-4 merged). */
async function fetchTmdbStills(malId) {
  if (!TMDB_API_KEY) return {}
  const tmdbId = await getTmdbIdFromMal(malId)
  if (!tmdbId) return {}

  const out = {}
  let running = 0
  for (let s = 1; s <= 4; s++) {
    let data
    try {
      const r = await axios.get(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${s}`, {
        params: { api_key: TMDB_API_KEY },
        timeout: 10_000,
        validateStatus: (code) => code >= 200 && code < 300,
      })
      data = r.data
    } catch {
      break // season doesn't exist — done
    }
    const eps = data?.episodes
    if (!Array.isArray(eps) || eps.length === 0) break
    for (const e of eps) {
      if (e?.still_path && e.episode_number) {
        out[running + e.episode_number] =
          `https://image.tmdb.org/t/p/w500${e.still_path}`
      }
    }
    running += eps.length
  }
  return out
}

// Real per-episode thumbnail map for an anime (all episodes in one call).
app.get('/api/episode-thumbs/:malId', async (req, res) => {
  try {
    const malId = Number(req.params.malId)
    if (!malId || isNaN(malId)) return res.status(400).json({ ok: false, error: 'Invalid MAL id' })
    const hit = tmdbThumbCache.get(malId)
    if (hit) {
      const ttl = Object.keys(hit.eps).length > 0 ? TMDB_THUMB_TTL : TMDB_EMPTY_TTL
      if (Date.now() - hit.at < ttl) return ok(res, { eps: hit.eps })
    }
    const eps = await fetchTmdbStills(malId)
    tmdbThumbCache.set(malId, { at: Date.now(), eps })
    if (tmdbThumbCache.size > 200) {
      const n = Date.now()
      for (const [k, v] of tmdbThumbCache) if (n - v.at > TMDB_THUMB_TTL) tmdbThumbCache.delete(k)
    }
    return ok(res, { eps })
  } catch (e) {
    fail(res, e)
  }
})

// ---------- HLS proxy (manifest rewriter + CORS bypass) ----------
// Optimizations: manifest cache (30s), segment cache headers, keep-alive,
// direct CDN routing (skip proxy for CDNs with CORS *).

const manifestCache = new Map()
const MANIFEST_TTL = 30 * 1000
function getCachedManifest(url) { const h = manifestCache.get(url); if (h && Date.now() - h.at < MANIFEST_TTL) return h.data; manifestCache.delete(url); return null }
function setCachedManifest(url, data) { manifestCache.set(url, { at: Date.now(), data }); if (manifestCache.size > 200) { const n = Date.now(); for (const [k, v] of manifestCache) if (n - v.at > MANIFEST_TTL) manifestCache.delete(k) } }

// ── CDN hosts known to send Access-Control-Allow-Origin: * on their
// m3u8 manifests AND segment files. For these hosts we can bypass the
// /proxy entirely — the browser loads streams directly, avoiding 403
// issues and reducing server load.
const CORS_CDN_HOSTS = new Set([
  '24stream.xyz',      // confirmed CORS *, works direct
  'fast4speed.xyz',    // same CDN family as 24stream
  'kwik.cx', 'uwucdn.com', 'uwucdn.top',  // miruro CDN, CORS *
  'anicrush.to', 'gniyonna.com',  // anicrush CDN, CORS *
  'mewstream.buzz', 'megaplay.buzz',  // sends CORS *, Cloudflare blocks server IPs but allows residential
])

/**
 * Check if a URL's host is in our known-CORS CDN list.
 * These CDNs send `access-control-allow-origin: *` so the browser can
 * load their m3u8 manifests and TS segments directly — no proxy needed.
 */
function isCorsCdn(url) {
  try {
    const host = new URL(url).hostname
    return [...CORS_CDN_HOSTS].some((h) => host.includes(h))
  } catch { return false }
}

// ── Anti-bot baseline headers for upstream requests ──
// These mimic a real Chrome browser to avoid Cloudflare / CDN blocks.
// Per-request 'origin' and 'referer' are set dynamically based on the
// target host because some CDNs require them to match.
const ANTI_BOT = {
  'sec-ch-ua-platform': '"Windows"',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'sec-ch-ua':
    '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  'sec-ch-ua-mobile': '?0',
  'accept': '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'accept-encoding': 'gzip, deflate, br',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
}

/**
 * Pick the right Referer for the target host. Most stream hosts only serve
 * content when the Referer matches their own origin (or a specific allow-list).
 * Returns an array of referer strings to try in order — the proxy retries
 * with each one if the previous gets a 403.
 */
function pickReferers(targetUrl) {
  try {
    const u = new URL(targetUrl)
    const host = u.hostname
    const cdnSelf = `${u.protocol}//${u.host}/`
    const refs = []
    if (host.includes('vidwish'))       { refs.push('https://vidwish.live/', cdnSelf) }
    else if (host.includes('mewstream')) { refs.push('https://megaplay.buzz/', 'https://mewstream.buzz/', 'https://anidap.lol/', cdnSelf) }
    else if (host.includes('megaplay'))  { refs.push('https://megaplay.buzz/', cdnSelf) }
    else if (host.includes('rapid-cloud')) { refs.push('https://rapid-cloud.co/', cdnSelf) }
    else if (host.includes('megacloud')) { refs.push('https://megacloud.blog/', cdnSelf) }
    else if (host.includes('krussdomi')) { refs.push('https://krussdomi.com/', cdnSelf) }
    else if (host.includes('4spromax'))  { refs.push('https://4spromax.site/', cdnSelf) }
    else if (host.includes('kem.clvd'))  { refs.push('https://kem.clvd.xyz/', cdnSelf) }
    else if (host.includes('senshi'))    { refs.push('https://senshi.live/', cdnSelf) }
    else if (host.includes('streamzone1')) { refs.push('https://megaplay.buzz/', cdnSelf) }
    else if (host.includes('24stream'))  { refs.push('https://anidap.lol/', cdnSelf) }
    else if (host.includes('fast4speed')) { refs.push('https://anidap.lol/', cdnSelf) }
    else if (host.includes('zaza.animex')) { refs.push('https://anidap.lol/', cdnSelf) }
    else if (host.includes('cors.otakuu')) { refs.push('https://anidap.lol/', cdnSelf) }
    else if (host.includes('animex'))    { refs.push('https://anidap.lol/', cdnSelf) }
    else if (host.includes('anidb.app')) { refs.push('https://anidb.app/', cdnSelf) }
    // Miruro CDN hosts (kwik/uwucdn — direct m3u8, CORS * )
    else if (host.includes('uwucdn'))    { refs.push('https://kwik.cx/', cdnSelf) }
    else if (host.includes('kwik'))      { refs.push('https://kwik.cx/', cdnSelf) }
    // Consumet-routed hosts (AnimeSaturn / AnimeSama upstreams)
    else if (host.includes('streampeaker')) { refs.push('https://www.animesaturn.cx/', cdnSelf) }
    else if (host.includes('sakana'))    { refs.push('https://www.animesaturn.cx/', cdnSelf) }
    // Anicrush / Gojo hosts
    else if (host.includes('anicrush'))  { refs.push('https://anicrush.to/', cdnSelf) }
    else if (host.includes('gniyonna'))  { refs.push('https://anicrush.to/', cdnSelf) }
    else if (host.includes('nekostream')) { refs.push('https://anikototv.to/', cdnSelf) }
    else if (host.includes('vizcloud'))  { refs.push('https://vizcloud.online/', cdnSelf) }
    else if (host.includes('cloudmb'))   { refs.push('https://cloudmb.com/', cdnSelf) }
    else if (host.includes('miruro'))    { refs.push('https://www.miruro.tv/', cdnSelf) }
    else if (host.includes('mp4upload')) { refs.push('https://www.mp4upload.com/', cdnSelf) }
    else if (host.includes('filemoon'))  { refs.push('https://filemoon.sx/', cdnSelf) }
    else if (host.includes('streamtape')) { refs.push('https://streamtape.com/', cdnSelf) }
    else if (host.includes('hd-1'))      { refs.push('https://anicrush.to/', cdnSelf) }
    else if (host.includes('hd-2'))      { refs.push('https://anicrush.to/', cdnSelf) }
    else { refs.push(cdnSelf) }
    return refs
  } catch {
    return ['https://anidap.lol/']
  }
}

// Dirty-dedupe subtitle 404s so we don't spam the console
const subtitleLogOnce = new Set()

app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url
  if (!targetUrl) return res.status(400).send('No URL provided')

  // Optional per-stream upstream headers (Referer/Origin/User-Agent) that
  // the scraper says the host requires. Passed as base64-encoded JSON in
  // `?h=…` so they survive HLS manifest rewriting cleanly.
  //   Example: ?h=eyJSZWZlcmVyIjoiaHR0cHM6Ly9tZWdhcGxheS5idXp6LyJ9
  // We also forward these to every segment we proxy so playback doesn't
  // 403 mid-stream.
  let upstreamHeaders = {}
  if (req.query.h) {
    try {
      upstreamHeaders = JSON.parse(
        Buffer.from(String(req.query.h), 'base64').toString('utf8'),
      ) || {}
    } catch { /* ignore malformed h param */ }
  }

  // ── Build request headers: anti-bot baseline + dynamic Referer/Origin ──
  // that match the target host. Hosts like MegaCloud, VizCloud, and
  // Filemoon check BOTH Referer AND Origin against their allow-list.
  // Build referer candidates: upstream headers first, then our known-good
  // pickReferers list as fallback. Previously, if upstreamHeaders had a
  // Referer, we used ONLY that one — if it was wrong (CDN changed policy),
  // the proxy failed 403 immediately with no retry.
  const upstreamRef = upstreamHeaders.Referer || upstreamHeaders.referer
  const picked = pickReferers(targetUrl)
  const refCandidates = upstreamRef
    ? [upstreamRef, ...picked.filter(r => r !== upstreamRef)]
    : picked
  const primaryReferer = refCandidates[0]
  const reqHeaders = {
    ...ANTI_BOT,
    referer: primaryReferer,
    origin: upstreamHeaders.Origin || upstreamHeaders.origin || (primaryReferer ? new URL(primaryReferer).origin : new URL(targetUrl).origin),
  }

  if (upstreamHeaders['User-Agent'] || upstreamHeaders['user-agent']) {
    reqHeaders['user-agent'] = upstreamHeaders['User-Agent'] || upstreamHeaders['user-agent']
  }

  // Only forward essential cookies or tokens if explicitly provided
  if (upstreamHeaders.Cookie || upstreamHeaders.cookie) {
    reqHeaders.cookie = upstreamHeaders.Cookie || upstreamHeaders.cookie
  }

  // ── CRITICAL: Forward client Range header for fast-forward / seek.
  // When the user clicks the timeline, the browser sends a byte-range
  // request. We MUST forward it so the upstream CDN responds with a
  // 206 Partial Content instead of a full 200. Without this, seeking
  // fails or the stream drops entirely.
  const clientRange = req.headers['range']
  if (clientRange) {
    reqHeaders['range'] = clientRange
  }

  // Default User-Agent if none provided in upstreamHeaders
  if (!reqHeaders['user-agent']) {
    reqHeaders['user-agent'] = ANTI_BOT['user-agent']
  }

  // ── Fetch with multi-referer 403 auto-retry + full response processing ──
  // When the first referer gets 403, we try remaining candidates from
  // pickReferers() (e.g. megaplay.buzz → mewstream.buzz → cdn.mewstream.buzz).
  // Everything is wrapped in a single try/catch so that fetch errors
  // (403, 404, timeout, etc.) AND processing errors both result in a
  // clean HTTP error response to the client — never an unhandled
  // rejection that crashes the server.
  try {
    let response
    let triedRefs = [primaryReferer]

    try {
      response = await axios.get(targetUrl, {
        headers: reqHeaders,
        responseType: 'stream',
        maxRedirects: 5,
        timeout: 20000,
        validateStatus: (s) => s >= 200 && s < 400,
        proxy: shouldUseProxy(targetUrl) ? RESIDENTIAL_PROXY : undefined,
      })
    } catch (firstErr) {
      if (firstErr.response?.status === 403 && refCandidates.length > 1) {
        // Try remaining referer candidates (skip the first one — already failed)
        let succeeded = false
        for (let i = 1; i < refCandidates.length; i++) {
          const altRef = refCandidates[i]
          const altOrigin = new URL(altRef).origin
          console.warn(`[proxy] 403 for ${String(targetUrl).slice(0, 100)}, retrying with referer: ${altRef}`)
          triedRefs.push(altRef)
          try {
            response = await axios.get(targetUrl, {
              headers: { ...reqHeaders, referer: altRef, origin: altOrigin },
              responseType: 'stream',
              maxRedirects: 5,
              timeout: 20000,
              validateStatus: (s) => s >= 200 && s < 400,
              proxy: shouldUseProxy(targetUrl) ? RESIDENTIAL_PROXY : undefined,
            })
            succeeded = true
            break
          } catch (retryErr) {
            console.warn(`[proxy] Retry with referer ${altRef} also failed: ${retryErr.response?.status || retryErr.message}`)
          }
        }
        // Last resort 1: try with no Referer/Origin at all (some CDNs just
        // want the request to not look like a cross-origin navigation).
        if (!succeeded) {
          const { referer: _r, origin: _o, ...headersNoRef } = reqHeaders
          console.warn(`[proxy] 403 for ${String(targetUrl).slice(0, 100)}, retrying with no referer`)
          try {
            response = await axios.get(targetUrl, {
              headers: headersNoRef,
              responseType: 'stream',
              maxRedirects: 5,
              timeout: 20000,
              validateStatus: (s) => s >= 200 && s < 400,
              proxy: shouldUseProxy(targetUrl) ? RESIDENTIAL_PROXY : undefined,
            })
            succeeded = true
          } catch (retryErr) {
            console.warn(`[proxy] No-referer retry also failed: ${retryErr.response?.status || retryErr.message}`)
          }
        }
        // Last resort 2: minimal headers — strip ALL security headers
        // (sec-fetch-*, sec-ch-ua-*) and Accept-Language/Encoding.
        // Some CDNs reject requests that send sec-fetch-site: cross-site
        // without a matching Referer or Origin.
        if (!succeeded) {
          const minimalHeaders = {
            'user-agent': reqHeaders['user-agent'] || ANTI_BOT['user-agent'],
            'accept': '*/*',
          }
          // Preserve upstream auth/cookie/token headers if needed
          if (reqHeaders.cookie) minimalHeaders.cookie = reqHeaders.cookie
          console.warn(`[proxy] 403 for ${String(targetUrl).slice(0, 100)}, retrying with minimal headers`)
          try {
            response = await axios.get(targetUrl, {
              headers: minimalHeaders,
              responseType: 'stream',
              maxRedirects: 5,
              timeout: 20000,
              validateStatus: (s) => s >= 200 && s < 400,
              proxy: shouldUseProxy(targetUrl) ? RESIDENTIAL_PROXY : undefined,
            })
            succeeded = true
          } catch (retryErr) {
            console.warn(`[proxy] Minimal-headers retry also failed: ${retryErr.response?.status || retryErr.message}`)
          }
        }
        if (!succeeded) throw firstErr
      } else {
        throw firstErr
      }
    }

    const contentType = response.headers['content-type'] || ''
    res.set('access-control-allow-origin', '*')

    const urlLower = String(targetUrl).toLowerCase()
    const isVttUrl = urlLower.includes('.vtt') || contentType.includes('text/vtt')
    const isSrtUrl = urlLower.includes('.srt')
    const isM3u8 = urlLower.includes('.m3u8') || contentType.includes('mpegurl')

    // Video/audio segments — these are the big files we must stream.
    // Detect by URL extension, Content-Type, OR fallback heuristic:
    // if the request came through our own m3u8 proxy (inferred from the
    // h= query param or from the fact it's NOT a known text/subtitle
    // format), treat unknown binary blobs as streaming segments.
    //
    // This is CRITICAL for cors.otakuu.se segments, which have no .ts
    // extension and often serve application/octet-stream as Content-Type.
    // Without this, the proxy buffers the ENTIRE 5MB segment in memory
    // before sending a single byte — causing the "play 5s, lag, play"
    // stutter pattern the user reported.
    const isVideoSegment =
      /\.(ts|mp4|webm|m4s|m2ts|mp2t|aac|mp3|m4a|mov|mkv|ogv)(\?|$)/i.test(urlLower) ||
      contentType.startsWith('video/') ||
      contentType.startsWith('audio/') ||
      // Fallback: unknown binary from proxy path is almost certainly a
      // segment. We detect this because it's not VTT, SRT, M3U8, text,
      // JSON, and it came through our proxy (has h= or is relative path).
      ((contentType.includes('application/octet-stream') || !contentType) && !isVttUrl && !isSrtUrl && !isM3u8)
    const isText = contentType.startsWith('text/') ||
                   contentType.includes('application/json') ||
                   (!contentType && !isVideoSegment)

    if (isVideoSegment && !isVttUrl && !isSrtUrl && !isM3u8) {
      res.set('content-type', contentType || 'application/octet-stream')
      // Cache video segments in browser for 1h — they are immutable.
      res.set('cache-control', 'public, max-age=3600, immutable')

      // ── Range-aware forwarding for fast-forward / seek ──
      if (response.status === 206) {
        res.status(206)
        if (response.headers['content-range']) res.set('content-range', response.headers['content-range'])
      } else {
        res.status(response.status)
      }

      // Forward range/caching headers from upstream.
      if (response.headers['accept-ranges']) res.set('accept-ranges', response.headers['accept-ranges'])
      if (response.headers['content-length']) res.set('content-length', response.headers['content-length'])

      // ── Socket leak prevention ──
      // When the client disconnects (tab close, HLS.js abort, seek),
      // we MUST cancel the upstream stream. Otherwise the download
      // continues in the background, consuming a socket from the
      // keep-alive pool (maxSockets: 50). After a few aborts the
      // pool is exhausted and new segments stall waiting for a socket.
      req.on('close', () => {
        if (!response.data.destroyed) response.data.destroy()
      })
      res.on('error', (err) => {
        console.error('[proxy] client disconnect:', err.message)
        response.data.destroy()
      })
      response.data.on('error', (err) => {
        console.error('[proxy] upstream stream error:', err.message)
        if (!res.headersSent && !res.writableEnded) res.status(502).send('Upstream stream error')
        else if (!res.writableEnded) res.end()
      })

      response.data.pipe(res)
      return
    }

    const chunks = []
    response.data.on('data', (chunk) => chunks.push(chunk))

    // Cancel upstream download if the client disconnects while we're
    // buffering (e.g., HLS.js aborted a subtitle fetch). Without this,
    // the abandoned download ties up a socket in the keep-alive pool.
    req.on('close', () => {
      if (!response.data.destroyed) response.data.destroy()
    })

    let content
    try {
      await new Promise((resolve, reject) => {
        response.data.on('end', resolve)
        response.data.on('error', (err) => {
          console.error('[proxy] buffer stream error:', err.message)
          reject(err)
        })
      })
      content = Buffer.concat(chunks)
    } catch (streamErr) {
      return res.status(502).send('Failed to read upstream response')
    }

    // ─── Subtitle MIME-fixing ────────────────────────────────────────
    // Some upstream hosts serve subtitles as application/octet-stream
    // (or text/plain). Browsers silently REFUSE to render <track> cues
    // unless the MIME type is text/vtt. We detect VTT bodies by either
    // URL extension, content-type, or magic bytes and force-correct
    // the content-type.
    //
    // We also auto-convert SRT to WebVTT on the fly — anidap providers
    // occasionally serve .srt for older episodes.
    if (isVttUrl) {
      const text = content.toString('utf8')
      // Normalize CRLF -> LF and ensure WEBVTT header is present.
      let normalized = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
      if (!normalized.trimStart().startsWith('WEBVTT')) {
        normalized = 'WEBVTT\n\n' + normalized
      }
      res.set('content-type', 'text/vtt; charset=utf-8')
      return res.send(normalized)
    }
    if (isSrtUrl) {
      const srt = content.toString('utf8')
      const vtt = srtToVtt(srt)
      res.set('content-type', 'text/vtt; charset=utf-8')
      return res.send(vtt)
    }

    // ─── Magic-bytes subtitle detection for URL-less subtitle files ───
    // Many CDN subtitle URLs look like "https://cdn.example.com/abc123?token=…"
    // without a .vtt extension and with a generic Content-Type. Peek the
    // first few bytes to detect the actual format and force-correct.
    if (isText || contentType.includes('application/octet-stream')) {
      const peek = content.toString('utf8', 0, 128)
        .replace(/^\uFEFF/, '')
        .trimStart()
      if (peek.startsWith('WEBVTT')) {
        const text = content.toString('utf8')
        let normalized = text.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
        if (!normalized.trimStart().startsWith('WEBVTT')) {
          normalized = 'WEBVTT\n\n' + normalized
        }
        res.set('content-type', 'text/vtt; charset=utf-8')
        return res.send(normalized)
      }
      // SRT heuristic: first line is a cue number, second is a timestamp
      if (/^\d+\s*\n\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(peek)) {
        const srt = content.toString('utf8')
        const vtt = srtToVtt(srt)
        res.set('content-type', 'text/vtt; charset=utf-8')
        return res.send(vtt)
      }
    }

    res.set('content-type', contentType)

    // Rewrite m3u8 manifests so segment URLs go through this proxy too.
    // Carry the `h=` upstream-headers param forward to every segment so
    // playback doesn't 403 mid-stream when the host checks Referer.
    if (isM3u8) {
      // Check manifest cache first
      const cachedM = getCachedManifest(targetUrl)
      if (cachedM) {
        res.set('content-type', 'application/vnd.apple.mpegurl; charset=utf-8')
        res.set('cache-control', 'public, max-age=10, must-revalidate')
        return res.send(cachedM)
      }
      const text = content.toString('utf8')
      const baseUrl = new URL(targetUrl)
      const hSuffix = req.query.h ? `&h=${encodeURIComponent(String(req.query.h))}` : ''
      const rewritten = text
        .split('\n')
        .map((rawLine) => {
          const line = rawLine.trim()
          if (!line) return rawLine
          // Rewrite URIs embedded in HLS directive attributes
          // (#EXT-X-KEY, #EXT-X-I-FRAME-STREAM-INF, #EXT-X-MAP etc.)
          // so the browser fetches keys / iframes / init segments through
          // the proxy and gets proper CORS headers.
          if (line.startsWith('#')) {
            return rawLine.replace(
              /\bURI="(https?:\/\/[^"]+)"/gi,
              (_m, url) => `URI="/proxy?url=${encodeURIComponent(url)}${hSuffix}"`,
            )
          }
          if (line.startsWith('http')) {
            return `/proxy?url=${encodeURIComponent(line)}${hSuffix}`
          }
          const absolute = new URL(line, baseUrl).href
          return `/proxy?url=${encodeURIComponent(absolute)}${hSuffix}`
        })
        .join('\n')
      const buf = Buffer.from(rewritten, 'utf8')
      setCachedManifest(targetUrl, buf)
      res.set('content-type', 'application/vnd.apple.mpegurl; charset=utf-8')
      res.set('cache-control', 'public, max-age=10, must-revalidate')
      return res.send(buf)
    }

    res.send(content)
  } catch (e) {
    const status = e.response?.status || 500
    const shortUrl = String(targetUrl).slice(0, 120)
    const urlLower = String(targetUrl).toLowerCase()
    const isSubtitle = urlLower.includes('.vtt') || urlLower.includes('.srt') || urlLower.includes('subtitle')

    // Subtitle 404s are expected for many episodes — downgrade to debug
    if (status === 404 && isSubtitle) {
      // Log once per unique URL per server session to avoid console spam
      if (!subtitleLogOnce.has(shortUrl)) {
        subtitleLogOnce.add(shortUrl)
        console.warn(`[proxy] subtitle 404 (expected) → ${shortUrl}`)
      }
    } else {
      console.error(`[proxy] ${status} ${e.message} → ${shortUrl}`)
    }

    // Guard: if headers were already sent (e.g. during video segment
    // streaming), we can't send a new status code — just end the response.
    if (!res.headersSent) {
      res.status(status).send(e.message)
    } else {
      res.end()
    }
  }
})

// ────────── Jikan API proxy ──────────────────────────────────────────
// Jikan (api.jikan.moe) has strict rate limits (3 req/sec). Proxying
// through the backend lets us share the rate-limit pool across all users
// and avoid browser CORS preflight on the public API.
//
// We add:
//   • server-side in-memory cache (10 min) so repeat page loads are instant
//   • in-flight deduplication so concurrent identical requests share one upstream
//   • a backend rate-limiter (max 2 concurrent, ~3 req/sec average) to keep
//     Jikan happy without serializing every request
//   • retry with exponential backoff / Retry-After for 429 / 504 / 5xx / network errors
//   • short negative-cache for failures to avoid hammering a dead upstream
//   • graceful fallback for non-critical endpoints like /recommendations
const JIKAN_CACHE_TTL = 10 * 60 * 1000
// Stale-while-revalidate window: if a cached entry is older than the normal
// TTL but younger than this, we still serve it while refreshing in the
// background. This keeps the UI working when Jikan is flaky.
const JIKAN_STALE_TTL = 30 * 60 * 1000
const JIKAN_FAIL_TTL = 30 * 1000
const JIKAN_MIN_INTERVAL = 250 // ~4 req/sec (Jikan allows 3, so we stay under)
const JIKAN_MAX_CONCURRENT = 3
const jikanCache = new Map()
const jikanFailCache = new Map()
const jikanInFlight = new Map()
let jikanRunning = 0
let jikanQueueTail = Promise.resolve()

function getJikanCacheKey(path, query) {
  return `jikan:${path}:${JSON.stringify(query || {})}`
}

function pruneJikanCache() {
  const now = Date.now()
  for (const [key, value] of jikanCache) {
    if (now - value.at > JIKAN_CACHE_TTL) jikanCache.delete(key)
  }
  for (const [key, value] of jikanFailCache) {
    if (now - value.at > JIKAN_FAIL_TTL) jikanFailCache.delete(key)
  }
}

// Periodic prune every 60s so stale entries don't linger
setInterval(pruneJikanCache, 60_000)

function enqueueJikanRequest(task) {
  const run = jikanQueueTail.then(async () => {
    // Wait until we have a free concurrency slot
    while (jikanRunning >= JIKAN_MAX_CONCURRENT) {
      await new Promise((r) => setTimeout(r, 50))
    }
    jikanRunning++
    try {
      const result = await task()
      return result
    } finally {
      jikanRunning--
      // Enforce average rate limit after each request finishes
      await new Promise((r) => setTimeout(r, JIKAN_MIN_INTERVAL))
    }
  })
  jikanQueueTail = run.catch(() => undefined)
  return run
}

async function fetchJikanWithRetry(targetUrl, query, maxRetries = 1) {
  // maxRetries=1: Jikan 504s mean MAL is down — the retry chain (1+2+4s
  // backoff) only added ~7s of dead time before the AniList fallback got a
  // chance. The parallel race now resolves via AniList while Jikan retries
  // in the background, so one retry is plenty for transient blips.
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { data, status, headers } = await axios.get(targetUrl, {
        params: query,
        // Jikan can be slow during peak hours; 8s per request leaves room
        // for retries before the route-level timeout fires.
        timeout: 8_000,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Kurodo/1.0 (https://kurodo.app; contact@kurodo.app)',
          Accept: 'application/json',
        },
      })

      // Success
      if (status >= 200 && status < 300) return { data, status }

      // Rate limited — honor Retry-After or use exponential backoff
      if (status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(headers?.['retry-after'] || '0', 10)
        const waitMs = retryAfter > 0
          ? retryAfter * 1000
          : Math.min(1000 * Math.pow(2, attempt), 8000)
        console.warn(`[jikan-proxy] 429 on ${targetUrl}, retrying after ${waitMs}ms`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }

      // Gateway timeout / server error — retry with backoff
      if ((status === 504 || status >= 500) && attempt < maxRetries) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 8000)
        console.warn(`[jikan-proxy] ${status} on ${targetUrl}, retrying after ${waitMs}ms`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }

      return { data, status }
    } catch (e) {
      // Network/timeout error — retry
      if (attempt < maxRetries) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 8000)
        console.warn(`[jikan-proxy] network error on ${targetUrl}: ${e.message}, retrying after ${waitMs}ms`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      throw e
    }
  }
  throw new Error('Jikan request failed after retries')
}

app.get('/api/jikan/*', async (req, res) => {
  // Prevent the Service Worker (and any intermediate cache) from serving
  // stale search results. Without these headers the SW's runtimeCaching
  // can return the same cached response for every query — the user's
  // reported "same anime no matter what" bug.
  res.set('Cache-Control', 'no-store, max-age=0, must-revalidate')

  const targetPath = req.path.replace(/^\/api\/jikan/, '')
  const targetUrl = `https://api.jikan.moe/v4${targetPath}`
  const cacheKey = getJikanCacheKey(targetPath, req.query)
  const isRecommendations = targetPath.endsWith('/recommendations')

  try {
    // 1. Check in-memory cache
    const cached = jikanCache.get(cacheKey)
    if (cached && Date.now() - cached.at < JIKAN_CACHE_TTL) {
      console.log(`[jikan-proxy] cache hit ${targetPath}`)
      return res.status(200).json(cached.data)
    }

    // 2. Check in-memory cache — including stale entries.  If the entry
    // is within the stale window but past the normal TTL, serve it now
    // and trigger a background refresh so the next request is fresh.
    const staleEntry = jikanCache.get(cacheKey)
    const staleAge = staleEntry ? Date.now() - staleEntry.at : Infinity
    if (staleEntry && staleAge < JIKAN_STALE_TTL) {
      if (staleAge < JIKAN_CACHE_TTL) {
        console.log(`[jikan-proxy] cache hit ${targetPath}`)
        return res.status(200).json(staleEntry.data)
      }
      console.log(`[jikan-proxy] serving stale cache for ${targetPath} while refreshing`)
      // Trigger background refresh without awaiting, but only if there isn't
      // already a refresh in flight for this key.
      if (!jikanInFlight.has(cacheKey)) {
        const refresh = enqueueJikanRequest(() => fetchJikanWithRetry(targetUrl, req.query))
        jikanInFlight.set(cacheKey, refresh)
        refresh
          .then(({ data, status }) => {
            if (status >= 200 && status < 300) {
              jikanCache.set(cacheKey, { at: Date.now(), data })
              console.log(`[jikan-proxy] refreshed stale cache for ${targetPath}`)
            } else {
              // Refresh returned an error status — record a short negative
              // cache entry so we don't hammer the upstream immediately.
              jikanFailCache.set(cacheKey, { at: Date.now(), message: `refresh status ${status}` })
            }
          })
          .catch((err) => {
            console.warn(`[jikan-proxy] background refresh failed for ${targetPath}:`, err.message)
            jikanFailCache.set(cacheKey, { at: Date.now(), message: err.message || 'refresh failed' })
          })
          .finally(() => jikanInFlight.delete(cacheKey))
      }
      return res.status(200).json(staleEntry.data)
    }

    // 3. Check negative cache — if this path recently failed, fail fast
    const failed = jikanFailCache.get(cacheKey)
    if (failed && Date.now() - failed.at < JIKAN_FAIL_TTL) {
      if (isRecommendations) {
        console.warn(`[jikan-proxy] negative cache hit ${targetPath}, returning empty recommendations`)
        return res.status(200).json({ data: [] })
      }
      return res.status(502).json({ status: 502, type: 'BadGateway', message: failed.message })
    }

    // 3. PARALLEL RACE: Jikan proxy + AniList fallback — first success wins.
    //    Jikan is frequently down (504) and its retry chain alone can burn
    //    10s+. We never wait for Jikan to exhaust before trying AniList:
    //    both fire at once, so search/details resolve in ~2-4s even when
    //    Jikan is 504ing and AniList is the only healthy source. The
    //    AniList fallback bypasses the Jikan queue entirely.
    const JIKAN_ROUTE_TIMEOUT_MS = 10_000

    // Pre-fire the AniList fallback immediately (not behind the Jikan queue).
    const fallbackReq = tryAniListFallback(targetPath, req.query)
      .catch(() => null)

    // Queued Jikan request (deduped across concurrent callers). The map
    // stores the RAW { data, status } promise; each caller reshapes it
    // locally so concurrent callers can't mis-destructure a reshaped value.
    let jikanRaw = jikanInFlight.get(cacheKey)
    if (!jikanRaw) {
      jikanRaw = enqueueJikanRequest(() => fetchJikanWithRetry(targetUrl, req.query))
      jikanInFlight.set(cacheKey, jikanRaw)
      jikanRaw.finally(() => jikanInFlight.delete(cacheKey))
    }
    const jikanReq = jikanRaw
      .then(({ data, status }) => (status >= 200 && status < 300 ? data : null))
      .catch(() => null)

    const winner = await new Promise((resolve) => {
      let done = false
      const win = (v) => { if (!done && v) { done = true; resolve(v) } }
      jikanReq.then(win)
      fallbackReq.then(win)
      // Once both settle with no winner, resolve null (fail fast).
      Promise.allSettled([jikanReq, fallbackReq]).then(() => {
        if (!done) { done = true; resolve(null) }
      })
      // Hard cap — never let a stalled Jikan queue hold the UI.
      setTimeout(() => {
        if (!done) { done = true; resolve(null) }
      }, JIKAN_ROUTE_TIMEOUT_MS)
    })

    if (winner) {
      jikanCache.set(cacheKey, { at: Date.now(), data: winner })
      if (jikanCache.size % 50 === 0) pruneJikanCache()
      return res.status(200).json(winner)
    }

    // ── Both sources failed or timed out — graceful degradation ──
    if (isRecommendations) {
      console.warn('[jikan-proxy] recommendations unavailable, returning empty')
      return res.status(200).json({ data: [] })
    }

    // The /anime/:id/full endpoint is heavy and often times out. Try the
    // lighter /anime/:id endpoint so the details page can still render.
    const fullMatch = targetPath.match(/^\/anime\/(\d+)\/full$/)
    if (fullMatch) {
      const liteUrl = `https://api.jikan.moe/v4/anime/${fullMatch[1]}`
      try {
        const lite = await fetchJikanWithRetry(liteUrl, req.query)
        if (lite.status >= 200 && lite.status < 300) {
          jikanCache.set(cacheKey, { at: Date.now(), data: lite.data })
          if (jikanCache.size % 50 === 0) pruneJikanCache()
          return res.status(200).json(lite.data)
        }
      } catch (liteErr) {
        // fall through to failure handling
      }
    }

    jikanFailCache.set(cacheKey, { at: Date.now(), message: 'Jikan and AniList both unavailable' })
    return res.status(502).json({
      status: 502,
      type: 'BadGateway',
      message: 'Search is temporarily unavailable — MyAnimeList (Jikan) is down and AniList is rate-limiting. Try again in a moment.',
    })
  } catch (e) {
    console.error('[jikan-proxy]', e?.message || e)

    // Cache the failure briefly to stop retry storms
    // But if the full anime endpoint failed, try a lighter non-full fallback first.
    const fullMatch = targetPath.match(/^\/anime\/(\d+)(?:\/full)?$/)
    if (fullMatch) {
      const liteUrl = `https://api.jikan.moe/v4/anime/${fullMatch[1]}`
      try {
        const lite = await fetchJikanWithRetry(liteUrl, req.query)
        if (lite.status >= 200 && lite.status < 300) {
          jikanCache.set(cacheKey, { at: Date.now(), data: lite.data })
          if (jikanCache.size % 50 === 0) pruneJikanCache()
          return res.status(200).json(lite.data)
        }
      } catch (liteErr) {
        // fall through to cache failure
      }
    }

    // ── AniList fallback for Jikan 504s / outages ──
    // Jikan frequently 504s when MyAnimeList is unreachable. Fall back to
    // AniList so the frontend can still render search/details.
    try {
      const fallback = await tryAniListFallback(targetPath, req.query)
      if (fallback) {
        jikanCache.set(cacheKey, { at: Date.now(), data: fallback })
        return res.status(200).json(fallback)
      }
    } catch (fallbackErr) {
      console.error('[jikan-proxy] AniList fallback failed:', fallbackErr?.message || fallbackErr)
    }

    jikanFailCache.set(cacheKey, { at: Date.now(), message: e?.message || 'Jikan proxy error' })

    // Graceful fallback for recommendations — the page doesn't break
    if (isRecommendations) {
      return res.status(200).json({ data: [] })
    }

    res.status(502).json({ status: 502, type: 'BadGateway', message: 'Jikan proxy error' })
  }
})

// ────────── AniList GraphQL proxy ──────────────────────────────────────
// The browser cannot call graphql.anilist.co directly because AniList
// doesn't send CORS headers on its GraphQL endpoint. This relay proxies
// all GraphQL requests through the backend so every page — anime
// details, manga tabs, browse, schedule, seasonal — works everywhere.
//
// Includes automatic retry for 429 rate limits: waits for the Retry-After
// header (or exponential backoff 1s→2s→4s), retries up to 3 times.
//
// Server-side cache: most AniList queries are public and expensive
// (especially search/details/seasonal). Cache successes for 5 min,
// keyed by query + variables + auth token so user-specific data never leaks.
const ANILIST_CACHE_TTL = 5 * 60 * 1000
// Stale-while-revalidate: serve older cached responses while refreshing in
// the background so the UI keeps working when AniList is rate-limiting.
const ANILIST_STALE_TTL = 15 * 60 * 1000
const ANILIST_FAIL_TTL = 30 * 1000
const anilistCache = new Map()
const anilistFailCache = new Map()
const anilistInFlight = new Map()

function getAnilistCacheKey(query, variables, token) {
  return `anilist:${crypto.createHash('sha256').update(JSON.stringify({ query, variables, token })).digest('hex')}`
}

// Prune stale AniList cache entries every 60s to prevent unbounded growth
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of anilistCache) {
    if (now - value.at > ANILIST_CACHE_TTL) anilistCache.delete(key)
  }
  for (const [key, value] of anilistFailCache) {
    if (now - value.at > ANILIST_FAIL_TTL) anilistFailCache.delete(key)
  }
}, 60_000)

app.post('/api/anilist-gql', async (req, res) => {
  try {
    const { query, variables } = req.body || {}
    if (!query) return res.status(400).json({ data: null, errors: [{ message: 'Missing GraphQL query' }] })

    const token = req.headers.authorization || ''
    const cacheKey = getAnilistCacheKey(query, variables, token)

    // 1. Check in-memory cache — including stale entries.  If a stale
    // entry exists, serve it immediately and refresh in the background.
    const cached = anilistCache.get(cacheKey)
    const cacheAge = cached ? Date.now() - cached.at : Infinity
    if (cached && cacheAge < ANILIST_STALE_TTL) {
      if (cacheAge < ANILIST_CACHE_TTL) {
        console.log('[anilist-gql] cache hit')
        return res.status(200).json(cached.data)
      }
      console.log('[anilist-gql] serving stale cache while refreshing')
      // Trigger background refresh without awaiting, but only if there isn't
      // already a refresh in flight for this key.
      if (!anilistInFlight.has(cacheKey)) {
        const refresh = (async () => {
          try {
            const { data, status } = await axios.post(
              'https://graphql.anilist.co',
              { query, variables: variables || {} },
              { headers: reqHeaders, timeout: 15_000, validateStatus: () => true },
            )
            if (status >= 200 && status < 300) {
              anilistCache.set(cacheKey, { at: Date.now(), data })
              console.log('[anilist-gql] refreshed stale cache')
            } else {
              anilistFailCache.set(cacheKey, { at: Date.now(), message: `refresh status ${status}` })
            }
            return { data, status }
          } catch (err) {
            console.warn('[anilist-gql] background refresh failed:', err.message)
            anilistFailCache.set(cacheKey, { at: Date.now(), message: err.message || 'refresh failed' })
            throw err
          } finally {
            anilistInFlight.delete(cacheKey)
          }
        })()
        anilistInFlight.set(cacheKey, refresh)
      }
      return res.status(200).json(cached.data)
    }

    // 2. Check negative cache — fail fast if this query recently failed
    const failed = anilistFailCache.get(cacheKey)
    if (failed && Date.now() - failed.at < ANILIST_FAIL_TTL) {
      console.warn('[anilist-gql] negative cache hit')
      return res.status(502).json({ data: null, errors: [{ message: failed.message }] })
    }

    const reqHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
    if (token) reqHeaders.Authorization = token

    const MAX_RETRIES = 3
    let lastError = null

    // Deduplicate concurrent identical requests
    let inFlight = anilistInFlight.get(cacheKey)
    if (!inFlight) {
      inFlight = (async () => {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            const { data, status } = await axios.post(
              'https://graphql.anilist.co',
              { query, variables: variables || {} },
              { headers: reqHeaders, timeout: 15_000, validateStatus: () => true },
            )

            // Success — cache and return
            if (status >= 200 && status < 300) {
              anilistCache.set(cacheKey, { at: Date.now(), data })
              return { data, status }
            }

            // 429 — extract wait time from Retry-After header, or use exponential backoff
            if (status === 429) {
              const retryAfter = parseInt(data?.headers?.['retry-after'] || '0', 10)
              const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.pow(2, attempt) * 1000
              const capped = Math.min(waitMs, 10000)

              if (attempt < MAX_RETRIES) {
                console.warn(`[anilist-gql] 429 rate-limited (attempt ${attempt + 1}/${MAX_RETRIES + 1}), waiting ${capped}ms...`)
                await new Promise((r) => setTimeout(r, capped))
                continue
              }

              console.error(`[anilist-gql] 429 after ${MAX_RETRIES + 1} attempts, giving up`)
              return { data: { data: null, errors: [{ message: 'AniList is rate-limiting — please wait a moment and try again.' }] }, status: 429 }
            }

            // Non-success status — don't cache, just return
            return { data, status }
          } catch (e) {
            lastError = e
            if (attempt < MAX_RETRIES) {
              const waitMs = Math.pow(2, attempt) * 1000
              console.warn(`[anilist-gql] transport error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${e.message}, waiting ${waitMs}ms`)
              await new Promise((r) => setTimeout(r, waitMs))
              continue
            }
          }
        }
        throw lastError || new Error('AniList GraphQL unreachable')
      })()
      anilistInFlight.set(cacheKey, inFlight)
      inFlight.finally(() => anilistInFlight.delete(cacheKey))
    }

    const { data, status } = await inFlight

    if (status >= 200 && status < 300) {
      return res.status(status).json(data)
    }

    // Cache failures briefly to stop retry storms
    if (status >= 500 || status === 429) {
      anilistFailCache.set(cacheKey, { at: Date.now(), message: data?.errors?.[0]?.message || 'AniList GraphQL error' })
    }

    return res.status(status).json(data)
  } catch (e) {
    console.error('[anilist-gql]', e?.message || e)
    res.status(502).json({ data: null, errors: [{ message: `GraphQL proxy error: ${e?.message || 'unknown'}` }] })
  }
})

// ────────── AniList OAuth token relay (external browser → Electron app) ──
// When the user signs in via external browser (not Electron), the OAuth
// callback runs in the browser tab. The browser POSTs the token here, and
// the Electron app polls GET to pick it up. Tokens auto-expire after 2 min.
const relayTokens = new Map() // state → { token, expiresIn, at }
const RELAY_TTL = 2 * 60 * 1000 // 2 min — enough for the user to switch back

// Clean up expired relay tokens every 30s
setInterval(() => {
  const n = Date.now()
  for (const [k, v] of relayTokens) if (n - v.at > RELAY_TTL) relayTokens.delete(k)
}, 30000)

app.post('/api/anilist/relay-token', (req, res) => {
  const { token, expiresIn, state } = req.body || {}
  if (!token || !state) {
    return res.status(400).json({ ok: false, error: 'Missing token or state' })
  }
  relayTokens.set(String(state), { token, expiresIn: Number(expiresIn) || 31536000, at: Date.now() })
  console.log('[anilist/relay] Stored token for state:', String(state).slice(0, 8))
  return res.json({ ok: true })
})

app.get('/api/anilist/relay-token', (req, res) => {
  const state = String(req.query.state || '')
  if (!state) return res.status(400).json({ ok: false, error: 'Missing state' })
  const entry = relayTokens.get(state)
  if (!entry) return res.json({ ok: true, data: null })
  relayTokens.delete(state)
  console.log('[anilist/relay] Delivered token for state:', state.slice(0, 8))
  return res.json({ ok: true, data: { token: entry.token, expiresIn: entry.expiresIn } })
})

// ---------- AniList OAuth: authorization-code exchange ----------
// Confidential AniList clients (the kind with a Client Secret) use the
// Authorization Code grant. The browser receives a `?code=...` query
// param at the callback URL, then has to POST it here so we can swap
// it for an access token using our server-side ANILIST_CLIENT_SECRET.
//
// Required env vars (in .env.local):
//   VITE_ANILIST_CLIENT_ID=42167          (also used by the frontend)
//   ANILIST_CLIENT_SECRET=xxxxxxxxxxxxx   (SERVER-ONLY — never expose)
//
// AniList's token endpoint demands form-urlencoded body, not JSON.
// Sending JSON returns: "unsupported_grant_type — Check that all required
// parameters have been provided".
app.post('/api/anilist/exchange', async (req, res) => {
  const { code, redirectUri } = req.body || {}
  if (!code || !redirectUri) {
    return res.status(400).json({
      ok: false,
      error: 'Missing required field: code or redirectUri',
    })
  }
  const clientId = process.env.VITE_ANILIST_CLIENT_ID || process.env.ANILIST_CLIENT_ID
  const clientSecret = process.env.ANILIST_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    const missing = [
      !clientId && 'VITE_ANILIST_CLIENT_ID',
      !clientSecret && 'ANILIST_CLIENT_SECRET',
    ].filter(Boolean).join(' + ')
    console.error('[anilist/exchange] missing env:', missing)
    return res.status(500).json({
      ok: false,
      error:
        `AniList OAuth not configured on server (missing ${missing}). ` +
        'Add the variable(s) to .env.local and restart the dev server.',
    })
  }

  try {
    // AniList's token endpoint requires form-urlencoded body per OAuth2
    // spec. Sending JSON returns: "unsupported_grant_type — Check that
    // all required parameters have been provided".
    //   https://docs.anilist.co/guide/auth/
    const tokenUrl = 'https://anilist.co/api/v2/oauth/token'
    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('client_id', String(clientId))
    params.append('client_secret', String(clientSecret))
    params.append('redirect_uri', String(redirectUri))
    params.append('code', String(code))

    console.log('[anilist/exchange] →', tokenUrl, {
      client_id: String(clientId),
      redirect_uri: String(redirectUri),
      code: String(code).slice(0, 8) + '…',
      secret_len: String(clientSecret).length,
    })

    const { data, status } = await axios.post(tokenUrl, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      timeout: 10_000,
      validateStatus: () => true,  // we want to inspect non-2xx ourselves
    })

    if (status >= 400 || !data?.access_token) {
      // Echo AniList's exact error back to the UI so it's debuggable.
      console.error('[anilist/exchange] AniList rejected:', status, JSON.stringify(data))
      const hint = data?.hint || data?.message || data?.error_description ||
                   data?.error || `AniList returned status ${status}`
      return res.status(status === 401 || status === 400 ? status : 502).json({
        ok: false,
        error: hint,
        upstream: status,
        debug: {
          // Helpful diagnostics for the user — never leaks the secret.
          sent_redirect_uri: String(redirectUri),
          sent_client_id: String(clientId),
          anilist_response: data,
        },
      })
    }

    console.log('[anilist/exchange] ✓ got token, expires in', data.expires_in, 's')
    return res.json({
      ok: true,
      data: {
        accessToken: data.access_token,
        expiresIn: Number(data.expires_in) || 31_536_000,
        tokenType: data.token_type || 'Bearer',
      },
    })
  } catch (e) {
    console.error('[anilist/exchange] network/transport error:', e.code || e.message)
    return res.status(502).json({
      ok: false,
      error: `Network error reaching AniList: ${e.code || e.message}`,
    })
  }
})

// ────────── Setup config — written by the NSIS installer ──────────────
// The custom installer writes kurodo-setup.json to the install directory.
// On first launch, the frontend fetches this to pre-fill AniList credentials
// and list preferences without the user having to re-enter them.
app.get('/api/setup-config', (_req, res) => {
  // Default config directory: same as the Electron app's install path.
  // In production (packaged Electron), process.resourcesPath points to
  // the resources/ dir inside the .asar; the config file sits one level
  // above in the install directory alongside Kurōdo.exe.
  try {
    let configPath
    if (process.resourcesPath) {
      // Electron packaged app: config is in the parent of resources/
      configPath = path.join(path.dirname(process.resourcesPath), 'kurodo-setup.json')
    } else {
      // Dev mode fallback: check the project root
      configPath = path.resolve(__dirname, '..', 'kurodo-setup.json')
    }
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw)
      return res.json({ ok: true, data: config })
    }
    return res.json({ ok: true, data: null, hint: 'No setup config found — first run or manual install' })
  } catch (e) {
    console.error('[setup-config] Error reading config:', e.message)
    return res.json({ ok: true, data: null, error: e.message })
  }
})

// ────────── AniSkip proxy — server-side only, no browser console errors ──
// The frontend used to call api.aniskip.com directly, which polluted the
// browser console with "Failed to load resource" errors whenever AniSkip
// had a transient 500 (which is common). Now the backend does the call
// and always returns 200 — null data when AniSkip is down, actual data
// when it's up. Results are cached: 1h for successes, 5min for failures.
const aniskipCache = new Map()
app.get('/api/aniskip/:malId/:ep', async (req, res) => {
  const malId = Number(req.params.malId)
  const ep = Number(req.params.ep)
  const episodeLength = Number(req.query.episodeLength || '0')

  const cacheKey = `aniskip:${malId}:${ep}`
  const hit = aniskipCache.get(cacheKey)
  if (hit && Date.now() - hit.at < hit.ttl) {
    return res.json({ ok: true, data: hit.value })
  }

  try {
    const types = ['op', 'ed', 'mixed-op', 'mixed-ed', 'recap']
    const params = new URLSearchParams()
    for (const t of types) params.append('types[]', t)
    params.append('episodeLength', String(episodeLength || 0))

    const { data: apiData, status } = await axios.get(
      `https://api.aniskip.com/v2/skip-times/${malId}/${ep}?${params}`,
      { timeout: 8000, validateStatus: () => true },
    )

    if (status >= 400 || !apiData?.found) {
      // Cache failure for 5 min so we don't hammer AniSkip while it's down
      aniskipCache.set(cacheKey, { at: Date.now(), value: null, ttl: 5 * 60 * 1000 })
      return res.json({ ok: true, data: null })
    }

    // Cache success for 1 hour — skip times don't change
    aniskipCache.set(cacheKey, { at: Date.now(), value: apiData, ttl: 60 * 60 * 1000 })
    return res.json({ ok: true, data: apiData })
  } catch {
    // Network error reaching AniSkip — return null, cache failure briefly
    aniskipCache.set(cacheKey, { at: Date.now(), value: null, ttl: 5 * 60 * 1000 })
    return res.json({ ok: true, data: null })
  }
})

let _harvesterIsReady = null
async function getHarvesterIsReady() {
  if (_harvesterIsReady) return _harvesterIsReady()
  const { isReady } = await import('./cf-harvester.js')
  _harvesterIsReady = isReady
  return isReady()
}

let _anidapRateLimit = null
async function getAnidapRateLimit() {
  if (_anidapRateLimit) return _anidapRateLimit
  const { isRateLimited, getRateLimitRemaining } = await import('./anidap.js')
  _anidapRateLimit = { isRateLimited, getRateLimitRemaining }
  return _anidapRateLimit
}

app.get('/api/health', async (_req, res) => {
  let browserReady = false
  let isRateLimited = false
  let rateLimitRemaining = 0
  try {
    browserReady = await getHarvesterIsReady()
  } catch { /* cf-harvester may not be loaded yet */ }
  try {
    const rl = await getAnidapRateLimit()
    isRateLimited = rl.isRateLimited()
    rateLimitRemaining = rl.getRateLimitRemaining()
  } catch { /* anidap may not be loaded yet */ }
  res.json({
    ok: true,
    service: 'kurodo-backend',
    uptime: Math.floor(process.uptime()),
    node: process.version,    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      memoryTotal: Math.round(process.memoryUsage().rss / 1024 / 1024),
      cache: {
        size: cache.size,
        failSize: failCache.size,
        streamCache: streamCache.size,
        manifestCache: manifestCache.size,
        inFlight: inFlight.size,
      },
    healthCheck: getHealthStats(),
    browserReady,
    isRateLimited,
    rateLimitRemaining,
    version: APP_VERSION,
  })
})

// GET /api/health/servers — full snapshot of currently cached health entries.
// Useful for ops dashboards / the in-app admin page.
app.get('/api/health/servers', (_req, res) => {
  const stats = getHealthStats()
  const recent = getRecentHealthEntries(50).map(([k, v]) => parseKeyRow(k, v))
  res.json({ ok: true, stats, recent })
})

function sanitizeDownloadFilename(slug, ep, provider, type) {
  // e.g. "one-piece-p8k27_EP01_dub_yuki"
  const s = `${slug || 'anime'}_EP${String(ep).padStart(2, '0')}_${type}_${provider}`
  return s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_').slice(0, 180)
}

function parseKeyRow(key, v) {
  // key shape: `${slug}:${ep}:${provider}:${type}`
  const parts = key.split(':')
  return {
    slug: parts[0],
    ep: Number(parts[1]) || null,
    provider: parts.slice(2, -1).join(':'),
    type: parts[parts.length - 1],
    ok: v.ok,
    ms: v.ms,
    error: v.ok ? null : (v.error || null),
    checkedAt: v.at,
  }
}

// ---------- Filler API proxy ----------
// The frontend needs filler data from public APIs that don't send CORS
// headers. Rather than fighting browser preflight, proxy through here.
// Filler lists are essentially static, so cache successes for 1 hour and
// failures for 5 minutes to avoid hammering these small free APIs.
const FILLER_CACHE_TTL = 60 * 60 * 1000
const FILLER_FAIL_TTL = 5 * 60 * 1000
const fillerCache = new Map()
const fillerFailCache = new Map()

// Prune stale filler cache entries every 60s to prevent unbounded growth
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of fillerCache) {
    if (now - value.at > FILLER_CACHE_TTL) fillerCache.delete(key)
  }
  for (const [key, value] of fillerFailCache) {
    if (now - value.at > FILLER_FAIL_TTL) fillerFailCache.delete(key)
  }
}, 60_000)

app.get('/api/filler/:malId', async (req, res) => {
  const malId = Number(req.params.malId)
  const title = String(req.query.title || '')
  if (!malId) return res.status(400).json({ error: 'malId required' })

  const cacheKey = `filler:${malId}`

  // Check cache
  const cached = fillerCache.get(cacheKey)
  if (cached && Date.now() - cached.at < FILLER_CACHE_TTL) {
    console.log(`[filler] cache hit ${malId}`)
    return res.json(cached.data)
  }

  // Check negative cache
  const failed = fillerFailCache.get(cacheKey)
  if (failed && Date.now() - failed.at < FILLER_FAIL_TTL) {
    console.warn(`[filler] negative cache hit ${malId}`)
    return res.status(404).json({ error: 'No filler data found' })
  }

  const apis = [
    `https://anime-filler-api.vercel.app/anime/${encodeURIComponent(title)}`,
    `https://api-filler.kotori.workers.dev/${malId}`,
  ]

  for (const url of apis) {
    try {
      const { data } = await axios.get(url, { timeout: 5000, validateStatus: (s) => s >= 200 && s < 300 })
      if (data && (data.filler_episodes || data.filler)) {
        fillerCache.set(cacheKey, { at: Date.now(), data })
        return res.json(data)
      }
    } catch { /* try next */ }
  }

  // Cache failure briefly
  fillerFailCache.set(cacheKey, { at: Date.now() })
  // Return empty — the frontend has offline fallback data for popular anime
  res.status(404).json({ error: 'No filler data found' })
})

// ────────── MAL username animelist proxy ──────────────────────────────
//
// MAL's animelist load.json endpoint is NOT CORS-enabled, so the browser
// cannot call it directly. This tiny proxy fetches the paginated JSON,
// normalizes it to MalXmlEntry shape, and returns a per-status summary.
//
// GET /api/mal/animelist?user=NAME
//
// Returns: { ok: true, data: { entries: MalXmlEntry[], counts, total } }
// Cached 5 min (MAL lists don't change every page load).

/** Map MAL's load.json numeric status → our internal status code. */
function malJsonStatusToNumber(status) {
  // load.json: 1=watching, 2=completed, 3=on_hold, 4=dropped, 6=plan_to_watch
  // Our malStatusToPlaylist expects these exact numbers, so passthrough.
  return Number(status) || 6
}

app.get('/api/mal/animelist', async (req, res) => {
  const user = String(req.query.user || '').trim()
  if (!user) return res.status(400).json({ ok: false, error: 'Missing ?user= parameter' })
  // Basic validation: MAL usernames are 2-16 chars, alphanum + _-
  if (!/^[a-zA-Z0-9_-]{2,16}$/.test(user)) {
    return res.status(400).json({ ok: false, error: 'Invalid MAL username format' })
  }

  try {
    const data = await cached(`mal:list:${user.toLowerCase()}`, 5 * 60 * 1000, async () => {
      const allEntries = []
      let offset = 0
      const PER_PAGE = 300
      const MAX_PAGES = 10  // safety cap: 3000 entries max
      const malAxios = axios.create({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0',
          'Accept': 'application/json',
        },
        timeout: 15_000,
      })

      let pagesFetched = 0
      for (let page = 0; page < MAX_PAGES; page++) {
        const url = `https://myanimelist.net/animelist/${encodeURIComponent(user)}/load.json?status=7&offset=${offset}`
        console.log(`[mal] fetching page ${page} (offset ${offset})`)
        const { data: items } = await malAxios.get(url)
        if (!Array.isArray(items) || items.length === 0) break
        pagesFetched = page + 1

        for (const item of items) {
          const malId = Number(item.anime_id)
          if (!malId || isNaN(malId)) continue
          allEntries.push({
            malId,
            title: String(item.anime_title || `MAL #${malId}`),
            type: String(item.anime_media_type_string || 'TV'),
            episodes: item.anime_num_episodes === 0 ? null : Number(item.anime_num_episodes) || null,
            status: malJsonStatusToNumber(item.status),
            watchedEpisodes: Number(item.num_watched_episodes) || 0,
            score: Number(item.score) || 0,
          })
        }

        // If we got fewer than PER_PAGE, we're done
        if (items.length < PER_PAGE) break
        offset += PER_PAGE
      }

      // Build counts (mirrors summarizeMalEntries on the server)
      const counts = { WATCHING: 0, PLAN_TO_WATCH: 0, COMPLETED: 0, ON_HOLD: 0, DROPPED: 0 }
      for (const e of allEntries) {
        switch (e.status) {
          case 1: counts.WATCHING++; break
          case 2: counts.COMPLETED++; break
          case 3: counts.ON_HOLD++; break
          case 4: counts.DROPPED++; break
          case 6: counts.PLAN_TO_WATCH++; break
        }
      }

      console.log(`[mal] ✓ ${user}: ${allEntries.length} entries across ${pagesFetched} pages`)
      return { entries: allEntries, counts, total: allEntries.length }
    })

    ok(res, data)
  } catch (e) {
    const status = e?.response?.status
    if (status === 404) {
      return res.status(404).json({ ok: false, error: `MAL user "${user}" not found.` })
    }
    if (status === 403 || status === 429) {
      return res.status(502).json({ ok: false, error: 'MAL is rate-limiting us — please wait a moment and try again.' })
    }
    console.error(`[mal] error for ${user}:`, e?.message || e)
    fail(res, e, 502)
  }
})

// Scraper diagnostic — used by the /scraper/debug page in the frontend.

// ────────── Manga routes — MangaDex API v5 proxy ──────────────────
// MangaDex data is largely static, but the API can be slow. Cache
// browse/search results for 5 min and detail/chapter/page data for 10 min.
const MANGA_CACHE_TTL = 5 * 60 * 1000
const MANGA_DETAIL_TTL = 10 * 60 * 1000
const mangaCache = new Map()
const mangaInFlight = new Map()

function cachedManga(key, ttl, fn) {
  const hit = mangaCache.get(key)
  if (hit && Date.now() - hit.at < ttl) return hit.value

  // Deduplicate concurrent identical requests
  const existing = mangaInFlight.get(key)
  if (existing) return existing

  const p = fn().then((value) => {
    mangaCache.set(key, { at: Date.now(), value })
    // Hard cap at 500 entries (LRU eviction)
    if (mangaCache.size > 500) {
      const oldest = mangaCache.keys().next().value
      if (oldest !== undefined) mangaCache.delete(oldest)
    }
    return value
  }).finally(() => {
    mangaInFlight.delete(key)
  })

  mangaInFlight.set(key, p)
  return p
}

app.get('/api/manga/search', async (req, res) => {
  try {
    const q = String(req.query.q || '')
    if (!q) return res.status(400).json({ ok: false, error: 'Missing ?q=' })
    const limit = Math.min(Number(req.query.limit) || 24, 100)
    const offset = Number(req.query.offset) || 0
    const data = await cachedManga(`manga:search:${q}:${limit}:${offset}`, MANGA_CACHE_TTL, () =>
      searchManga(q, { limit, offset }),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

app.get('/api/manga/latest', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 24, 100)
    const offset = Number(req.query.offset) || 0
    const data = await cachedManga(`manga:latest:${limit}:${offset}`, MANGA_CACHE_TTL, () =>
      getLatestManga({ limit, offset }),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

app.get('/api/manga/tag/:tagId', async (req, res) => {
  try {
    const { tagId } = req.params
    const limit = Math.min(Number(req.query.limit) || 24, 100)
    const offset = Number(req.query.offset) || 0
    const data = await cachedManga(`manga:tag:${tagId}:${limit}:${offset}`, MANGA_CACHE_TTL, () =>
      getMangaByTag(tagId, { limit, offset }),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

// GET /api/manga/browse — browse with genre/type/status/sort filters
app.get('/api/manga/browse', async (req, res) => {
  try {
    const genres = req.query.genres ? String(req.query.genres).split(',').filter(Boolean) : []
    const format = req.query.format || null
    const status = req.query.status ? String(req.query.status).split(',').filter(Boolean) : []
    const sort = req.query.sort || 'popular'
    const limit = Math.min(Number(req.query.limit) || 24, 100)
    const offset = Number(req.query.offset) || 0
    const cacheKey = `manga:browse:${genres.join(',')}:${format}:${status.join(',')}:${sort}:${limit}:${offset}`
    const data = await cachedManga(cacheKey, MANGA_CACHE_TTL, () =>
      browseManga({ genres, format, status, sort, limit, offset }),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

// GET /api/manga/tags — return available genre names + format/status/sort options
app.get('/api/manga/tags', (_req, res) => {
  res.json({
    ok: true,
    data: {
      genres: Object.keys(GENRE_MAP).sort(),
      formats: Object.keys(FORMAT_TAGS),
      statuses: ['ongoing', 'completed', 'hiatus', 'cancelled'],
      sorts: Object.keys(SORT_ORDERS),
    },
  })
})

app.get('/api/manga/info/:mangaId', async (req, res) => {
  try {
    const { mangaId } = req.params
    const data = await cachedManga(`manga:info:${mangaId}`, MANGA_DETAIL_TTL, () =>
      getMangaInfo(mangaId),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

app.get('/api/manga/chapters/:mangaId', async (req, res) => {
  try {
    const { mangaId } = req.params
    const lang = String(req.query.lang || 'en')
    const limit = Math.min(Number(req.query.limit) || 96, 500)
    const offset = Number(req.query.offset) || 0
    const data = await cachedManga(`manga:chapters:${mangaId}:${lang}:${limit}:${offset}`, MANGA_CACHE_TTL, () =>
      getChapterFeed(mangaId, { language: lang, limit, offset }),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

app.get('/api/manga/pages/:chapterId', async (req, res) => {
  try {
    const { chapterId } = req.params
    const data = await cachedManga(`manga:pages:${chapterId}`, MANGA_DETAIL_TTL, () =>
      getChapterPages(chapterId),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

// ────────── Atsu.moe manga routes — alternative manga source ──────────
app.get('/api/atsu/search', async (req, res) => {
  try {
    const q = String(req.query.q || '')
    if (!q) return res.status(400).json({ ok: false, error: 'Missing ?q=' })
    const limit = Math.min(Number(req.query.limit) || 24, 100)
    const offset = Number(req.query.offset) || 0
    const data = await cachedManga(`atsu:search:${q}:${limit}:${offset}`, MANGA_CACHE_TTL, () =>
      searchMangaAtsu(q, { limit, offset }),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

app.get('/api/atsu/info/:atsuId', async (req, res) => {
  try {
    const { atsuId } = req.params
    const data = await cachedManga(`atsu:info:${atsuId}`, MANGA_DETAIL_TTL, () =>
      getMangaInfoAtsu(atsuId),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

app.get('/api/atsu/chapters/:atsuId', async (req, res) => {
  try {
    const { atsuId } = req.params
    const data = await cachedManga(`atsu:chapters:${atsuId}`, MANGA_CACHE_TTL, () =>
      getChapterFeedAtsu(atsuId),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

app.get('/api/atsu/pages/:atsuId/:chapterId', async (req, res) => {
  try {
    const { atsuId, chapterId } = req.params
    const data = await cachedManga(`atsu:pages:${atsuId}:${chapterId}`, MANGA_DETAIL_TTL, () =>
      getChapterPagesAtsu(atsuId, chapterId),
    )
    ok(res, data)
  } catch (e) { fail(res, e) }
})

app.get('/api/diag', async (req, res) => {
  try {
    const result = await runDiagnostics({
      anilistId: req.query.anilistId ? Number(req.query.anilistId) : undefined,
      episode: req.query.ep ? Number(req.query.ep) : undefined,
    })
    res.json({ ok: true, data: result })
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message ?? String(e) })
  }
})

// ---------- Image proxy with fallback chain ----------
//
// The browser can't easily fall back when a 3rd-party image returns 403 or
// loads as a black box. So this endpoint tries each URL in order and returns
// the first one that actually succeeds.
//
// Use:  /img?url=<primary>&url=<fallback1>&url=<fallback2>
//
// Returns 200 + image bytes (long-cache headers) or 200 with a styled SVG placeholder.
const imgCache = new Map()
const imgFailCache = new Map()
const IMG_CACHE_MAX = 200
const IMG_CACHE_TTL = 48 * 60 * 60 * 1000  // 48h — cover art rarely changes
const IMG_FAIL_TTL = 5 * 60 * 1000   // remember failures for 5min so retries are instant
const IMG_FETCH_TIMEOUT = 5000       // 5s — fast fail so the browser falls back to placeholder quickly

function pruneImgCache() {
  if (imgCache.size <= IMG_CACHE_MAX) return
  // Drop oldest 25%
  const drop = Math.floor(imgCache.size / 4)
  const keys = Array.from(imgCache.keys()).slice(0, drop)
  for (const k of keys) imgCache.delete(k)
}

// Prune stale failure entries periodically
function pruneImgFailCache() {
  const n = Date.now()
  // Drop expired entries
  for (const [k, v] of imgFailCache) if (n - v.at > IMG_FAIL_TTL) imgFailCache.delete(k)
  // Hard cap at 500 entries — drop oldest 25% if exceeded
  if (imgFailCache.size > 500) {
    const drop = Math.floor(imgFailCache.size / 4)
    const keys = Array.from(imgFailCache.keys()).slice(0, drop)
    for (const k of keys) imgFailCache.delete(k)
  }
}

const PLACEHOLDER_SVG = (label = '?') => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">
    <rect width="160" height="90" fill="hsl(0,0%,8%)"/>
    <rect x="0" y="0" width="160" height="90" fill="url(#g)"/>
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="160" y2="90">
        <stop offset="0%" stop-color="hsl(354,40%,15%)"/>
        <stop offset="100%" stop-color="hsl(0,0%,4%)"/>
      </linearGradient>
    </defs>
    <text x="80" y="52" font-family="system-ui,sans-serif" font-size="14"
      font-weight="700" fill="rgba(255,255,255,0.45)"
      text-anchor="middle">${label}</text>
  </svg>`, 'utf-8',
)

/**
 * Episode thumbnail card — composites the show cover image with an episode
 * number overlay. Returns a self-contained SVG that the browser renders
 * directly (no CORS issues since the image is loaded by the browser, not
 * by us via canvas).
 *
 * Used for shows where AniZip doesn't have per-episode screenshots (common
 * for long-running shounen like One Piece, Bleach, HxH). Each episode gets
 * a visually distinct card instead of every one showing the same cover.
 */
// ── Card-mode tiles: cover-embedded numbered episode cards ──
// The card SVG embeds the cover as a base64 data-URL (fetched server-side),
// making it fully self-contained — external <image href> URLs inside an SVG
// loaded via <img> are refused by many browsers (blank tiles), data-URLs
// render everywhere. The COVER data-URL is cached once per show (not per
// episode) and the tiny per-episode SVG string is built on the fly, so a
// 366-episode show costs ONE cached cover, not 366 × 700KB copies.
const coverDataCache = new Map() // coverUrl → { at, dataUrl }
const COVER_DATA_TTL = 24 * 60 * 60 * 1000

/** Fetch the cover bytes and return a base64 data-URL (cached per cover). */
async function getCoverDataUrl(coverUrl) {
  if (!coverUrl) return null
  const hit = coverDataCache.get(coverUrl)
  if (hit && Date.now() - hit.at < COVER_DATA_TTL) return hit.dataUrl
  let bytes = null
  let mime = 'image/jpeg'
  try {
    const r = await axios.get(coverUrl, {
      timeout: IMG_FETCH_TIMEOUT,
      responseType: 'arraybuffer',
      validateStatus: (s) => s >= 200 && s < 300,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
      maxRedirects: 3,
    })
    const ct = r.headers['content-type'] || ''
    if (ct.startsWith('image/') && r.data.length >= 200) {
      bytes = Buffer.from(r.data)
      mime = ct
    }
  } catch { /* fall through to placeholder */ }
  if (!bytes) return null
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpeg'
  const dataUrl = `data:image/${ext};base64,${bytes.toString('base64')}`
  coverDataCache.set(coverUrl, { at: Date.now(), dataUrl })
  if (coverDataCache.size > 300) {
    const n = Date.now()
    for (const [k, v] of coverDataCache) if (n - v.at > COVER_DATA_TTL) coverDataCache.delete(k)
    if (coverDataCache.size > 300) coverDataCache.delete(coverDataCache.keys().next().value)
  }
  return dataUrl
}

/** Build a self-contained numbered card SVG from an embedded cover data-URL. */
function buildCardSvg(dataUrl, epNum, accent, rawLabel) {
  const label = String(rawLabel || (epNum ? `EP ${epNum}` : '?')).slice(0, 24)
  if (!dataUrl) return PLACEHOLDER_SVG(label)
  const pillColor = accent && /^#[0-9a-fA-F]{6}$/.test(accent)
    ? accent
    : 'hsl(245,75%,60%)'
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 224 128">
    <defs>
      <clipPath id="c"><rect x="0" y="0" width="224" height="128" rx="6"/></clipPath>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="hsla(0,0%,4%,0.15)"/>
        <stop offset="65%" stop-color="hsla(0,0%,4%,0.35)"/>
        <stop offset="100%" stop-color="hsla(0,0%,4%,0.75)"/>
      </linearGradient>
    </defs>
    <rect width="224" height="128" rx="6" fill="hsl(0,0%,8%)"/>
    <image href="${dataUrl}" width="224" height="128"
      preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>
    <rect x="0" y="0" width="224" height="128" rx="6" fill="url(#g)"/>
    <rect x="6" y="100" width="46" height="22" rx="4" fill="${pillColor}" opacity="0.9"/>
    <text x="29" y="115" font-family="system-ui,sans-serif" font-size="11"
      font-weight="700" fill="white" text-anchor="middle"
      dominant-baseline="central">${label}</text>
  </svg>`, 'utf-8',
  )
}

app.get('/img', async (req, res) => {
  // ── Card mode: generate a numbered episode thumbnail card ──
  // /img?card=1&url=COVER_URL&ep=85
  // Returns a SELF-CONTAINED SVG (cover embedded as data-URL) so browsers
  // render it reliably inside <img>. Used only as the last-resort fallback
  // when no real per-episode screenshot exists.
  if (req.query.card === '1') {
    const cover = String(req.query.url || '')
    const ep = String(req.query.ep || '')
    const accent = String(req.query.accent || '')
    const dataUrl = await getCoverDataUrl(cover)
    const body = buildCardSvg(dataUrl, ep, accent, req.query.label ? String(req.query.label) : '')
    res.set('content-type', 'image/svg+xml')
    res.set('cache-control', 'public, max-age=86400, immutable')
    res.set('access-control-allow-origin', '*')
    return res.send(body)
  }

  const urls = []
    .concat(req.query.url || [])
    .flat()
    .filter(Boolean)
  const label = String(req.query.label || '').slice(0, 24)

  if (urls.length === 0) {
    res.set('content-type', 'image/svg+xml')
    res.set('cache-control', 'public, max-age=3600')
    return res.send(PLACEHOLDER_SVG(label || '?'))
  }

  // Cache by joined URL list — same fallback chain = same cached result
  const cacheKey = urls.join('|')

  // Check success cache first
  const hit = imgCache.get(cacheKey)
  if (hit && Date.now() - hit.at < IMG_CACHE_TTL) {
    res.set('content-type', hit.contentType)
    res.set('cache-control', 'public, max-age=86400, immutable')
    res.set('access-control-allow-origin', '*')
    return res.send(hit.body)
  }

  // Check negative cache — if this exact URL chain failed recently, skip instantly
  const failHit = imgFailCache.get(cacheKey)
  if (failHit && Date.now() - failHit.at < IMG_FAIL_TTL) {
    res.set('content-type', 'image/svg+xml')
    res.set('cache-control', 'public, max-age=600')
    // Use card SVG (cover + EP number) if coverUrl is available; plain placeholder otherwise
    const coverUrl = String(req.query.coverUrl || '')
    if (coverUrl) {
      const match = (label || '').match(/EP\s+(\d+)/i)
      const epNum = match ? match[1] : '?'
      const accent = String(req.query.accent || '')
      const dataUrl = await getCoverDataUrl(coverUrl)
      return res.send(buildCardSvg(dataUrl, epNum, accent, label))
    }
    return res.send(PLACEHOLDER_SVG(label || '?'))
  }

  // Check individual URL negative cache — skip known-dead URLs without fetching
  const deadUrls = new Set()
  for (const url of urls) {
    const df = imgFailCache.get(url)
    if (df && Date.now() - df.at < IMG_FAIL_TTL) deadUrls.add(url)
  }

  for (const url of urls) {
    // Skip URLs that consistently fail
    if (deadUrls.has(url)) continue
    // Add Referer for AniZip CDN (cdn.anizip.org blocks requests without it)
    const imgHeaders = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      'accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    }
    if (url.includes('anizip.org')) {
      imgHeaders['referer'] = 'https://api.ani.zip/'
      imgHeaders['sec-fetch-dest'] = 'image'
      imgHeaders['sec-fetch-mode'] = 'no-cors'
      imgHeaders['sec-fetch-site'] = 'cross-site'
    }
    try {
      const r = await axios.get(url, {
        timeout: IMG_FETCH_TIMEOUT,
        responseType: 'arraybuffer',
        validateStatus: (s) => s >= 200 && s < 300,
        headers: imgHeaders,
        maxRedirects: 3,
      })
      const ct = r.headers['content-type'] || ''
      // Some upstreams return XML error pages with 200 — reject those
      if (!ct.startsWith('image/') || r.data.length < 200) {
        imgFailCache.set(url, { at: Date.now() })
        continue
      }

      const body = Buffer.from(r.data)
      imgCache.set(cacheKey, { at: Date.now(), contentType: ct, body })
      pruneImgCache()
      res.set('content-type', ct)
      res.set('cache-control', 'public, max-age=86400, immutable')
      res.set('access-control-allow-origin', '*')
      return res.send(body)
    } catch {
      // Remember this URL as dead so next time we skip it instantly
      imgFailCache.set(url, { at: Date.now() })
    }
  }

  // Everything failed — try card SVG with cover art as ultimate fallback,
  // then plain placeholder as last resort.
  imgFailCache.set(cacheKey, { at: Date.now() })
  pruneImgFailCache()
  res.set('content-type', 'image/svg+xml')

  const coverUrl = String(req.query.coverUrl || '')
  if (coverUrl) {
    // Extract episode number from label like "EP 24" → "24"
    const match = (label || '').match(/EP\s+(\d+)/i)
    const epNum = match ? match[1] : '?'
    const accent = String(req.query.accent || '')
    const dataUrl = await getCoverDataUrl(coverUrl)
    res.set('cache-control', 'public, max-age=3600')
    return res.send(buildCardSvg(dataUrl, epNum, accent, label))
  }

  res.set('cache-control', 'public, max-age=600')
  res.status(200).send(PLACEHOLDER_SVG(label || '?'))
})

// ────────── Production static frontend serving ──────────────────────
//
// When `dist/` exists (i.e. after `npm run build`), serve the built PWA
// directly from this process. This is what makes the installed PWA work:
// one port, one process, no separate Vite dev server.
//
// Routes:
//   /               → dist/index.html  (the SPA shell)
//   /assets/*       → dist/assets/*    (JS/CSS chunks, hashed for long cache)
//   /sw.js          → dist/sw.js       (service worker — MUST be at root)
//   /manifest.webmanifest → dist/manifest.webmanifest
//   /pwa-*.svg      → dist/pwa-*.svg   (PWA icons)
//   /favicon.svg    → dist/favicon.svg
//   /workbox-*.js   → dist/workbox-*.js
//   /* (any SPA route) → dist/index.html  (React Router handles it)
//
// API routes (/api/*, /proxy, /img) are registered ABOVE this block,
// so they take priority over static file serving.

const distPath = path.resolve(__dirname, '..', 'dist')
const isProduction = fs.existsSync(distPath)

if (isProduction) {
  // Immutable hashed assets — cache forever (they change filename on rebuild)
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    immutable: true,
    maxAge: '365d',
  }))

  // Service worker, manifest, icons — short cache (they can change per deploy)
  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      const basename = path.basename(filePath)
      // hashed workbox files can be cached long
      if (basename.startsWith('workbox-')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else if (basename === 'sw.js') {
        // Service worker MUST have short cache (browser checks for updates)
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
        res.setHeader('Service-Worker-Allowed', '/')
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600')
      }
    },
  }))

  // SPA fallback — serve index.html for any route not caught by the API
  // or static file middleware above. React Router handles the actual routing.
  //
  // IMPORTANT: exclude static asset extensions (.js, .css, .png, .svg, .woff2,
  // .json, .map, .ico, .webmanifest) from the fallback. When the service worker
  // or browser requests a missing/deleted chunk, returning index.html (text/html)
  // causes the browser to throw "unsupported MIME type" console errors. A clean
  // 404 is the correct response for missing static files.
  app.get('*', (req, res) => {
    const ext = path.extname(req.path).toLowerCase()
    const isStaticAsset = ['.js', '.css', '.png', '.jpg', '.jpeg', '.webp',
      '.svg', '.woff', '.woff2', '.ttf', '.json', '.map', '.ico',
      '.webmanifest', '.xml', '.txt'].includes(ext)
    if (isStaticAsset) {
      return res.status(404).type('text/plain').send('Not found')
    }
    const indexPath = path.join(distPath, 'index.html')
    if (fs.existsSync(indexPath)) {
      // Prevent browser caching of index.html so new deploys take effect
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
      res.sendFile(indexPath)
    } else {
      res.status(404).send('App not built. Run `npm run build` first.')
    }
  })
}

const server = app.listen(PORT, () => {
  console.log(`🚀 Kurōdo listening on http://localhost:${PORT}`)
  console.log(`   • Scraper API: /api/anidap/*`)
  console.log(`   • HLS proxy:   /proxy?url=...`)
  console.log(`   • AniList auth: /api/anilist/exchange`)
  console.log(`   • Server health: /api/health/servers`)
  if (isProduction) {
    console.log(`   • Frontend:    http://localhost:${PORT}/  (serving dist/)`)
  }
  // Boot the background health-check scheduler — warms the cache so the
  // first user of a new session doesn't pay the full probe cost.
  startHealthCheckScheduler()

  // Pre-warm the Puppeteer browser bridge on startup so the first user
  // click doesn't wait 10-15s for Chrome cold-launch. The warmUp() call
  // navigates to anidap.se to establish a session + Cloudflare clearance.
  //
  // Stream URL pre-warming (navigating to a specific watch page to extract
  // the video src) is not feasible because anidap.se is a SvelteKit SPA
  // that loads the player lazily — the <video> element may not exist until
  // the user clicks play or the JS fully hydrates (5-15s after page load).
  // Repeated attempts at DOM-based stream pre-warming have proven unreliable.
  //
  // Instead, the browser is pre-warmed only (which saves 10-15s on first
  // call), and the first user stream load caches the result in streamCache
  // for 5min. Subsequent loads of the same episode are instant.
  import('./cf-harvester.js').then(({ warmUp }) => warmUp()).catch(() => {})
})

// ── Port-conflict recovery ──────────────────────────────────────
// When a second Kurōdo instance starts while the first is still running,
// node crashes with an unhandled EADDRINUSE. Instead of dying, check if
// the port is already serving a healthy Kurōdo backend and exit quietly —
// the Electron single-instance lock handles the GUI, but the standalone
// server (dev mode / scripts) can still hit this.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.warn(`[server] Port ${PORT} already in use — checking if it's a healthy Kurōdo instance…`)
    const probe = http.get(`http://localhost:${PORT}/api/health`, (res) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        try {
          const health = JSON.parse(body)
          if (health && health.ok && health.service === 'kurodo-backend') {
            console.log(`[server] Existing healthy Kurōdo on :${PORT} — exiting this duplicate.`)
            process.exit(0)
          }
        } catch { /* not our server */ }
        console.error(`[server] Port ${PORT} in use by another app — cannot start.`)
        process.exit(1)
      })
    })
    probe.on('error', () => {
      console.error(`[server] Port ${PORT} in use by another app — cannot start.`)
      process.exit(1)
    })
    probe.setTimeout(3000, () => {
      console.error(`[server] Port ${PORT} in use and unresponsive — cannot start.`)
      process.exit(1)
    })
  } else {
    console.error('[server] Failed to start:', err)
  }
})
