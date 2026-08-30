// server/lib/cf-harvester/shared.js — Shared utilities for the anidap browser bridge.
//
// This file is imported by both the Electron and Puppeteer implementations.

// server/cf-harvester.js — Browser bridge for anidap.se.
//
// Dual-mode architecture:
//
//   Electron mode (packaged app / electron:dev):
//     Uses a hidden BrowserWindow (show: false). This is a REAL Chrome
//     window — Cloudflare CANNOT fingerprint it as headless. Zero
//     ERR_ABORTED failures. Instant cold-start.
//
//   Standalone mode (npm start / dev):
//     Uses Puppeteer as a fallback. Headless Chrome is detected by
//     Cloudflare ~52% of the time, but safeGoto retries mitigate this.
//
// Both modes expose identical exports — callers (server/index.js,
// server/anidap.js) work with either.

import fs from 'node:fs'

const ANIDAP_BASE = 'https://anidap.lol'

// In-memory cache for AniList ID -> anidap slug. The SPA resolves the slug
// asynchronously, so polling the watch page is expensive. Caching the slug
// avoids that cost for every subsequent episode/provider request.
const slugCache = new Map()

// In-memory cache for AniList ID -> canonical title (english > romaji > native).
// Used to generate a fallback text slug when the watch page doesn't expose it.
const anilistTitleCache = new Map()

// Cloudflare Turnstile / challenge page detection.
// If Puppeteer lands here, the player will never load — fail fast.
function isCloudflareChallenge(body = '', title = '') {
  const t = title.toLowerCase()
  const b = body.toLowerCase()
  return (
    t.includes('just a moment') ||
    t.includes('checking your browser') ||
    t.includes('ddos-guard') ||
    b.includes('cf-turnstile') ||
    b.includes('turnstile') ||
    b.includes('cf-challenge') ||
    b.includes('checking your browser') ||
    b.includes('just a moment')
  )
}

// ── Mode detection ──────────────────────────────────────────────────
const IS_ELECTRON = typeof process !== 'undefined' && process.type === 'browser'

function trimUrl(url, maxLen = 80) {
  return url.length > maxLen ? url.slice(0, maxLen) + '…' : url
}

// Convert a human-readable title to a kebab-case slug, matching the format
// anidap.lol uses in its URLs.
function titleToSlug(title) {
  return title
    .toLowerCase()
    // Normalize punctuation so "Fate/stay night" and "JoJo's" keep separators.
    .replace(/[/']/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * Resolve a text slug for the given AniList ID by querying the AniList
 * GraphQL API. The result is cached and also stored in the shared slugCache
 * so subsequent calls are free. Returns null if the query fails or no
 * title is available.
 */
async function getAniListTitle(anilistId) {
  const cached = anilistTitleCache.get(anilistId)
  if (cached) return cached
  try {
    const resp = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        query: `query($id:Int){Media(id:$id,type:ANIME){title{romaji english native}}}`,
        variables: { id: Number(anilistId) },
      }),
      signal: AbortSignal.timeout(3_000),
    })
    const json = await resp.json()
    const title = json?.data?.Media?.title?.english
      || json?.data?.Media?.title?.romaji
      || json?.data?.Media?.title?.native
    if (title) {
      anilistTitleCache.set(anilistId, title)
      return title
    }
  } catch (e) {
    // AniList might be rate-limiting or unreachable; fail silently.
    console.warn(`[shared] Failed to fetch AniList title for ${anilistId}:`, e.message)
  }
  return null
}

/**
 * Fallback slug resolver using AniList metadata. Generates a kebab-case slug
 * from the anime's English/Romaji title. This is only used when the anidap
 * watch page does not expose the real slug.
 */
async function resolveSlugFromAniList(anilistId) {
  const cached = slugCache.get(anilistId)
  if (cached) return cached
  const title = await getAniListTitle(anilistId)
  if (!title) return null
  const slug = titleToSlug(title)
  slugCache.set(anilistId, slug)
  console.log(`[shared] Resolved slug from AniList title: ${anilistId} -> ${slug}`)
  return slug
}

// Shared budget helper: returns the milliseconds still available within the
// given extraction window, but never less than 2 s so callers always have a
// small timeout to work with.
function makeRemainingBudget(startMs, totalBudgetMs = 30_000) {
  return () => Math.max(2_000, totalBudgetMs - (Date.now() - startMs))
}

// Fast-path: fetch the chad sources endpoint directly from Node.js instead
// of round-tripping through the browser's executeJavaScript. This is the
// critical path for every stream click, so even a few hundred milliseconds
// saved here is a big UX win. The browser still provides Cloudflare
// clearance cookies when needed; without cookies we try anyway in case the
// endpoint is unauthenticated.
function formatCookieHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

async function directFetchChadSources(sourcesUrl, cookieHeader = '') {
  const headers = {
    'Accept': 'application/json',
    'Referer': 'https://anidap.lol/',
    'Origin': 'https://anidap.lol',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  }
  if (cookieHeader) headers['Cookie'] = cookieHeader

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 8_000)
  try {
    const resp = await fetch(sourcesUrl, { headers, signal: controller.signal })
    const text = await resp.text()
    if (!resp.ok) {
      return { ok: false, status: resp.status, body: text }
    }
    return { ok: true, status: resp.status, body: text }
  } catch (e) {
    return { ok: false, status: 0, body: e.message || 'aborted' }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Shared JS snippet for clicking the DUB tab on gogoanime.by ──
// Gogoanime uses a single page for both sub and dub; the dub players
// are hidden behind a tab/button that must be clicked to reveal them.
const CLICK_DUB_TAB_JS = `(() => {
  // Try common gogoanime dub tab selectors (ordered by specificity)
  const dubSelectors = [
    '.anime_muti_link a:last-child',
    '.anime_muti_link li:last-child a',
    '.dubing a', '.dubbing a',
    '[data-type="dub"]', '[data-server*="dub"]',
    'a[href*="dub"]', 'button[class*="dub"]',
  ]
  // Text-based: find elements containing "DUB" (case-insensitive)
  const allLinks = document.querySelectorAll('.anime_muti_link a, .dubing a, .dubbing a, .player-option a, .tab a, button')
  for (const el of allLinks) {
    if (/\\bDUB\\b/i.test(el.textContent?.trim() || '')) {
      el.click()
      return true
    }
  }
  // Fallback: selector-based
  for (const sel of dubSelectors) {
    try {
      const el = document.querySelector(sel)
      if (el) { el.click(); return true }
    } catch {}
  }
  return false
})()`

// ── Shared JS snippet for selecting the first gogoanime server ───
// gogoanime.by renders the player only after a server button is clicked.
// The #w-servers container has .player-type-link items with data-type
// ('sub' or 'dub'). Click the first matching one so the player iframe
// actually loads.
const CLICK_FIRST_SERVER_JS = `((type) => {
  const container = document.getElementById('w-servers')
  if (!container) return false
  const items = container.querySelectorAll('.player-type-link')
  if (!items.length) return false
  // Prefer the first item whose data-type matches the requested type.
  let target = null
  if (type) {
    for (const item of items) {
      if ((item.getAttribute('data-type') || '').toLowerCase() === type.toLowerCase()) {
        target = item
        break
      }
    }
  }
  if (!target) target = items[0]
  try { target.click() } catch { return false }
  return true
})`

// ── Shared JS snippet for extracting iframe src ────────────────────
// Runs in the browser context to find a video player iframe.
const EXTRACT_IFRAME_JS = `(() => {
  // Try known video player containers first (ordered by specificity)
  const selectors = [
    '#player iframe', '#video-player iframe',
    '.player-embed iframe', '.play-video iframe', '.video-player iframe',
    '.embed iframe', '.anime_video_body iframe', '.episode-video iframe',
    '[class*="player"] iframe', '[id*="player"] iframe',
  ]
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel)
      if (el && el.src && el.src.startsWith('http')) return el.src
    } catch {}
  }
  // Fallback: any iframe not from google/facebook/ads
  const all = document.querySelectorAll('iframe')
  for (const iframe of all) {
    const s = iframe.src || ''
    if (s.startsWith('http') && !s.includes('google') && !s.includes('facebook') && !s.includes('doubleclick')) {
      return s
    }
  }
  return null
})()`

// ── Shared JS snippet for extracting the real anidap text slug ──────
// The SSR HTML embeds it as a React prop right after the watch URL:
//   ..."watch?id=21&ep=1...","id","one-piece-p8k27","anilistId",21
// (JSON backslash escapes optional). Runs in the browser right after
// load — the slug is static SSR data, so this is instant and replaces the
// old 8s performance-entry poll. Falls back to the pathname (the SPA
// redirects /watch?id=... to /watch/<slug>... once the title resolves).
const EXTRACT_SLUG_JS = `(() => {
  try {
    // Un-escape the SSR JSON props (\" -> ", \\u0026 -> &) using split/join.
    // String.fromCharCode(92) = backslash — avoids backslash-escaping
    // pitfalls entirely (a backslash in a template literal would be
    // swallowed, producing a bare quote that matches nothing).
    const BS = String.fromCharCode(92)
    const clean = document.documentElement.innerHTML
      .split(BS + '"').join('"')
      .split(BS + 'u0026').join('&')
    // The SSR data embeds the slug as ..."id","<slug>","anilistId",<num>...
    // (the watch URL is a full http URL, so anchor on the prop sequence).
    const m = clean.match(/"id","([a-z0-9][a-z0-9-]{1,60})","anilistId"/)
    if (m) return m[1]
    // Fallback: the SPA redirects /watch?id=... to /watch/<slug>...
    const parts = location.pathname.split('/')
    if (parts[1] === 'watch' && parts[2]) return decodeURIComponent(parts[2])
  } catch {}
  return null
})()`

// ═══════════════════════════════════════════════════════════════════

export { ANIDAP_BASE, slugCache, isCloudflareChallenge, IS_ELECTRON, trimUrl, makeRemainingBudget, CLICK_DUB_TAB_JS, CLICK_FIRST_SERVER_JS, EXTRACT_IFRAME_JS, EXTRACT_SLUG_JS, resolveSlugFromAniList, formatCookieHeader, directFetchChadSources }
