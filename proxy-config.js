// server/proxy-config.js — shared residential proxy helper.
//
// CDNs like mewstream.buzz and streamzone1.site run Cloudflare with anti-bot
// that blocks datacenter IPs. Setting RESIDENTIAL_PROXY_URL routes requests
// through a residential IP so they appear as real user traffic.
//
// Format: RESIDENTIAL_PROXY_URL=http://user:pass@host:port
//
// IMPORTANT — bandwidth cost warning:
//   The /proxy HLS endpoint streams video segments (TS files) through this
//   proxy. A 24-minute anime episode with 70 segments is ~350-700 MB.
//   On pay-per-GB residential proxy plans (e.g. Bright Data at ~$15/GB),
//   that's $5-10 per episode. For development/testing, consider whitelisting
//   only specific domains or using a proxy plan with unlimited bandwidth.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * CDN hosts that Cloudflare blocks from datacenter IPs.
 * Only requests to these hosts are routed through the residential proxy.
 * Other CDNs (24stream, uwucdn, kwik, wixstatic, anicrush, etc.) go direct.
 */
export const PROXY_CDN_HOSTS = [
  'mewstream.buzz',
  'streamzone1.site',
  'megaplay.buzz',
]

/**
 * Parse RESIDENTIAL_PROXY_URL into an axios-compatible proxy config.
 * Returns undefined if the env var is not set or is malformed.
 */
export function buildProxyConfig(urlStr) {
  if (!urlStr) return undefined
  try {
    const u = new URL(urlStr)
    const cfg = {
      host: u.hostname,
      port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
      protocol: u.protocol.replace(':', ''),
    }
    if (u.username) cfg.auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }
    return cfg
  } catch (e) {
    console.warn('[proxy] RESIDENTIAL_PROXY_URL is malformed, ignoring:', urlStr, e?.message)
    return undefined
  }
}

/**
 * Returns true if the given URL's host should be routed through the
 * residential proxy (i.e. it's on a Cloudflare-blocked CDN).
 */
export function shouldUseProxy(url) {
  if (!url) return false
  try {
    const host = new URL(url).hostname
    return PROXY_CDN_HOSTS.some((h) => host.includes(h))
  } catch { return false }
}

// ── Gogoanime proxy rotation ───────────────────────────────────────
// Cloudflare rate-limits gogoanime.by heavily from datacenter IPs.
// Provide a pool of HTTP(S) proxies via GOGO_PROXIES env var or a
// gogo-proxies.txt file (one proxy per line). A random proxy is
// selected for each gogoanime request/session.

let _gogoProxyPool = []
const _deadProxyPenalties = new Map() // proxyKey -> expiry timestamp
const PROXY_DEAD_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function initGogoProxyPool() {
  const envProxies = process.env.GOGO_PROXIES
    ? process.env.GOGO_PROXIES.split(',').map(p => p.trim()).filter(Boolean)
    : []

  let fileProxies = []
  try {
    // Resolve relative to this module so it works in both dev and the
    // packaged Electron app, where process.cwd() is the install directory.
    const filePath = path.resolve(__dirname, '..', 'gogo-proxies.txt')
    if (fs.existsSync(filePath)) {
      fileProxies = fs.readFileSync(filePath, 'utf8')
        .split('\n')
        .map(p => p.trim())
        .filter(Boolean)
        .filter(p => !p.startsWith('#'))
    }
  } catch {}

  const rawList = [...envProxies, ...fileProxies]
  _gogoProxyPool = rawList.map(buildProxyConfig).filter(Boolean)

  if (_gogoProxyPool.length > 0) {
    console.log(`[proxy] Gogoanime proxy pool loaded: ${getGogoProxyPoolSize()} proxies`)
  }
}

export function proxyToString(proxy) {
  if (!proxy) return 'direct'
  const auth = proxy.auth ? `${proxy.auth.username}:****@` : ''
  return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`
}

export function getRandomGogoProxy() {
  const now = Date.now()
  // Clean expired penalties lazily
  for (const [key, expiry] of _deadProxyPenalties.entries()) {
    if (expiry <= now) _deadProxyPenalties.delete(key)
  }

  const alive = _gogoProxyPool.filter((p) => {
    const key = `${p.host}:${p.port}`
    return !_deadProxyPenalties.has(key)
  })

  if (alive.length === 0) {
    // All proxies marked dead; reset penalties and try again
    if (_gogoProxyPool.length > 0) {
      console.warn('[proxy] All gogo proxies marked dead — clearing penalties and retrying')
      _deadProxyPenalties.clear()
      return _gogoProxyPool[Math.floor(Math.random() * _gogoProxyPool.length)]
    }
    return null
  }
  return alive[Math.floor(Math.random() * alive.length)]
}

export function markProxyDead(proxy) {
  if (!proxy) return
  const key = `${proxy.host}:${proxy.port}`
  _deadProxyPenalties.set(key, Date.now() + PROXY_DEAD_TTL_MS)
  console.warn(`[proxy] Marked gogo proxy dead for 5 min: ${proxy.host}:${proxy.port}`)
}

export function getGogoProxyPoolSize() {
  return _gogoProxyPool.length
}
