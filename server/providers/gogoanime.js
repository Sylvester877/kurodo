// server/providers/gogoanime.js — GogoAnime (gogoanime.by) scraper.
//
// Implements the unified ScraperProvider interface.

import axios from 'axios'
import { extractStreamFromWatchPage } from '../cf-harvester.js'
import { getRandomGogoProxy } from '../proxy-config.js'

const BASE = 'https://gogoanime.by'

// User-Agent rotation pool — rotating UAs reduces Cloudflare fingerprinting
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
]
let _uaIdx = 0
function pickUA() {
  _uaIdx = (_uaIdx + 1) % UA_POOL.length
  return UA_POOL[_uaIdx]
}

// Request throttle — minimum 3s between gogoanime HTTP requests
const HTTP_THROTTLE_MS = 3000
let _lastHttpRequest = 0
function getAxiosInst() {
  return axios.create({
    headers: {
      'User-Agent': pickUA(),
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
    maxRedirects: 5,
    proxy: getRandomGogoProxy() || false,
  })
}

// Throttled axios wrapper — measures gap from request COMPLETION, not start.
// Retries up to 2 times on proxy/network failures, cycling to another
// random proxy (or direct) so a single dead proxy doesn't break gogoanime.
async function throttledGet(url, opts = {}, retries = 2) {
  const elapsed = Date.now() - _lastHttpRequest
  if (elapsed < HTTP_THROTTLE_MS) {
    const delay = HTTP_THROTTLE_MS - elapsed
    await new Promise(r => setTimeout(r, delay))
  }
  _lastHttpRequest = Date.now()
  const inst = getAxiosInst()  // fresh UA + random proxy per request
  try {
    return await inst.get(url, opts)
  } catch (err) {
    // Retry on any network-level failure (no HTTP response) or on proxy
    // authentication failures (407). This covers dead proxies, DNS issues,
    // connection resets, and bad proxy credentials, while avoiding retries
    // on actual source errors like 403/404.
    const isProxyAuthError = err.response?.status === 407
    const isRetryable = isProxyAuthError || (!err.response && (err.code || err.message))
    if (retries > 0 && isRetryable) {
      console.warn(`[gogoanime] Request failed (${err.message || err.code}${isProxyAuthError ? ' 407' : ''}), retrying ${retries} more time(s)`)
      return throttledGet(url, opts, retries - 1)
    }
    throw err
  } finally {
    _lastHttpRequest = Date.now()  // reset to completion time so gap is between requests
  }
}

const slugCache = new Map()

// Cheap pre-flight cache: slugs confirmed NOT on this mirror (their episode
// URL redirects to the homepage). One HTTP GET is enough; don't re-probe the
// same slug for an hour — repeated provider attempts would otherwise each
// launch a ~30s browser extraction only to fail.
const mirrorMissCache = new Map() // slug -> expiry (ms)
const MIRROR_MISS_TTL = 60 * 60 * 1000

// Fast existence check (~1-2s via throttledGet): gogoanime.by redirects
// unknown/new slugs to the homepage (`final URL == BASE`). Detect that
// BEFORE the ~30s browser extraction so titles that aren't on this mirror
// fail fast instead of grinding every provider in the fallback chain.
async function episodeOnMirror(watchUrl, slug) {
  if (!slug) return true
  const cached = mirrorMissCache.get(slug)
  if (cached && Date.now() < cached) return false
  try {
    const r = await throttledGet(watchUrl, { maxRedirects: 5, validateStatus: () => true })
    const finalUrl = (r?.request?.res?.responseUrl || r?.request?.responseURL || watchUrl)
    const landedHome = /^https?:\/\/gogoanime\.by\/?$/.test(finalUrl)
    if (landedHome) {
      mirrorMissCache.set(slug, Date.now() + MIRROR_MISS_TTL)
      return false
    }
    return true
  } catch {
    // Network/proxy error here — let the real extraction decide (it may
    // have a working proxy). Don't negative-cache on a transport failure.
    return true
  }
}
const titleCache = new Map()
const SLUG_TTL = 24 * 60 * 60 * 1000
const TITLE_TTL = 7 * 24 * 60 * 60 * 1000

function titleToSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-')
}

async function slugExists(slug) {
  for (const prefix of ['category', 'series']) {
    try { const r = await throttledGet(`${BASE}/${prefix}/${slug}/`, { validateStatus: s => s < 500 }); if (r.status < 400) return slug } catch {}
  }
  return null
}

// Score a mirror slug against the query title by shared-word overlap.
// Handles the season aliasing that defeats the old exact-substring match:
// "Mushoku Tensei Season 3" -> "mushoku-tensei-ii-isekai-ittara-honki-dasu-
// part-2" (shares mushoku/tensei) and "Reincarnated as a Slime Season 4"
// -> "tensei-shitara-slime-datta-ken-4th-season" (shares tensei/slime/season).
function tokenOverlapScore(slug, title) {
  const slugTok = new Set((slug || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1))
  const titleTok = (title || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)
  const norm = (t) => (t === 'ii' ? '2' : t === 'iii' ? '3' : t === 'iv' ? '4' : t === 'v' ? '5' : t)
  const STOP = new Set(['season', 'part', 'the', 'of', 'and', 'movie', 'anime'])
  let matched = 0
  for (const tok of titleTok) {
    const n = norm(tok)
    if (slugTok.has(tok) || slugTok.has(n)) matched++
  }
  const coverage = titleTok.length ? matched / titleTok.length : 0
  const meaningful = titleTok.filter((t) => !STOP.has(t) && !/^[ivx]+$/i.test(t)).length
  const meaningfulMatched = titleTok.filter((t) => !STOP.has(t) && !/^[ivx]+$/i.test(t) && (slugTok.has(t) || slugTok.has(norm(t)))).length
  return { score: coverage + (meaningful ? 0.3 * (meaningfulMatched / meaningful) : 0), coverage, meaningful, meaningfulMatched }
}

async function searchByTitle(title) {
  if (!title) return null
  const q = encodeURIComponent(title.replace(/[^a-zA-Z0-9 ]/g, '').trim())
  if (!q) return null
  try {
    const { data: body } = await throttledGet(`${BASE}/?s=${q}`)
    const matches = [...body.matchAll(/href="https?:\/\/gogoanime\.by\/(series|category)\/([^"]+)"/gi)]
    const slugs = [...new Set(matches.map(m => m[2].replace(/\/$/, '')))]
    if (slugs.length === 0) return null
    const titleSlug = titleToSlug(title)
    // Exact match wins immediately.
    const exact = slugs.find((s) => s === titleSlug || s.includes(titleSlug) || titleSlug.includes(s))
    if (exact) return exact
    // Otherwise pick the best token-overlap candidate above a floor. Guard
    // against cross-title false positives (e.g. "Mushoku Tensei III" must
    // not resolve to Slime S3 just because they share "tensei") by requiring
    // the title's LEADING distinctive token to also appear in the slug.
    const STOP = new Set(['season', 'part', 'the', 'of', 'and', 'movie', 'anime'])
    const titleTok = (title || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2)
    const lead = titleTok.find((t) => !STOP.has(t) && !/^[ivx]+$/i.test(t))
    const candidates = slugs.map((s) => ({ s, ...tokenOverlapScore(s, title) }))
    let best = null
    let bestScore = 0
    for (const c of candidates) {
      if (lead && !c.s.includes(lead)) continue
      if (c.score > bestScore) { bestScore = c.score; best = c.s }
    }
    if (best && bestScore >= 0.45) return best
    return null
  } catch {}
  return null
}

async function getAniListMedia(anilistId) {
  const cached = titleCache.get(anilistId)
  if (cached && Date.now() - cached.at < TITLE_TTL) return cached.data
  try {
    const { data: json } = await axios.post('https://graphql.anilist.co',
      { query: `query($id:Int){Media(id:$id,type:ANIME){title{romaji english} episodes}}`, variables: { id: anilistId } },
      { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: 8000 })
    const media = json?.data?.Media
    if (!media) return null
    const data = {
      romaji: media.title.romaji || null,
      english: media.title.english || null,
      episodes: media.episodes || null,
    }
    titleCache.set(anilistId, { at: Date.now(), data })
    return data
  } catch { return null }
}

// Keep the old name as an alias for backward compatibility.
async function getAniListTitle(anilistId) {
  return getAniListMedia(anilistId)
}

async function resolveSlug(anilistId) {
  const cached = slugCache.get(anilistId)
  if (cached && Date.now() - cached.at < SLUG_TTL) return cached.slug
  const media = await getAniListMedia(anilistId)
  if (!media) return null
  const searchTitle = media.english || media.romaji
  if (!searchTitle) return null
  console.log(`[gogoanime] Searching for: ${searchTitle} (#${anilistId})`)
  let slug = await searchByTitle(searchTitle)
  if (!slug && media.english && media.romaji && media.english !== media.romaji)
    slug = await searchByTitle(media.romaji)
  if (slug) { slugCache.set(anilistId, { at: Date.now(), slug }); console.log(`[gogoanime] Resolved #${anilistId} -> ${slug}`) }
  else console.warn(`[gogoanime] Could not find slug for #${anilistId} ("${searchTitle}")`)
  return slug
}

// If we have an AniList ID, resolve the real gogoanime slug from the
// title. The caller-supplied slug is often the anidap slug (e.g. 'naruto')
// and may not match gogoanime's canonical slug (e.g. 'naruto-shippuuden').
async function resolveGogoSlug(slug, anilistId) {
  if (!anilistId) return slug
  // If the caller already gave us a slug that exists on gogoanime,
  // skip the expensive title search.
  if (slug && !(await slugExists(slug))) {
    const resolved = await resolveSlug(Number(anilistId))
    if (resolved) {
      console.log(`[gogoanime] Resolved AniList #${anilistId} -> ${resolved}`)
      return resolved
    }
    console.warn(`[gogoanime] Could not resolve real slug for #${anilistId}; using provided slug "${slug}"`)
  }
  return slug
}

function parseEpisodesFromHtml(body, slug) {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Match flexible episode URL formats:
  //   /relife-episode-1/  (bare)
  //   /relife-episode-1-english-subbed/  (suffixed)
  //   href="https://gogoanime.by/relife-episode-1"
  const epRegex = new RegExp(
    `/${escaped}-episode-(\\d+)(?:-english-(?:subbed|dubbed))?/?["'>\\s]`,
    'gi'
  )
  const episodes = new Map()
  for (const m of body.matchAll(epRegex)) {
    const num = parseInt(m[1])
    if (!isNaN(num) && num > 0 && num <= 2000) {
      const isSub = m[0].toLowerCase().includes('subbed') || !m[0].toLowerCase().includes('dubbed')
      const isDub = m[0].toLowerCase().includes('dubbed')
      const existing = episodes.get(num)
      episodes.set(num, {
        number: num,
        hasSub: existing ? (existing.hasSub || isSub) : isSub,
        hasDub: existing ? (existing.hasDub || isDub) : isDub,
      })
    }
  }
  return [...episodes.values()].sort((a, b) => a.number - b.number)
}

export const gogoanimeProvider = {
  name: 'gogoanime',

  async getInfoByAniListId(anilistId) {
    const id = Number(anilistId)
    if (!id || isNaN(id)) return { slug: null }
    const slug = await resolveSlug(id)
    return { slug }
  },

  async getEpisodes(slug, anilistId) {
    if (!slug) return []
    slug = await resolveGogoSlug(slug, anilistId)
    // Gogoanime stream URLs are predictable: /slug-episode-N-english-subbed/.
    // We don't need to scrape the series page for links; AniList gives us the
    // episode count, which is more reliable than the dynamic HTML.
    let totalEps = 0
    if (anilistId) {
      const media = await getAniListMedia(Number(anilistId))
      totalEps = media?.episodes || 0
    }
    // Fallback: try to parse the series page if AniList has no episode count.
    if (!totalEps) {
      try {
        let body, status
        for (const base of [`${BASE}/series/${slug}/`, `${BASE}/category/${slug}/`]) {
          try { const resp = await throttledGet(base); if (resp.status === 200) { body = resp.data; status = 200; break } } catch {}
        }
        if (status === 200 && body) {
          const parsed = parseEpisodesFromHtml(body, slug)
          if (parsed.length > 0) {
            console.log(`[gogoanime] Found ${parsed.length} episodes from HTML for ${slug}`)
            return parsed
          }
        }
      } catch (e) { console.warn(`[gogoanime] HTML parse failed for ${slug}:`, e.message) }
      // Last resort: assume a standard 12-episode cour so the UI isn't empty.
      totalEps = 12
      console.warn(`[gogoanime] No episode count from AniList or HTML for ${slug}; defaulting to ${totalEps}`)
    }
    const episodes = Array.from({ length: totalEps }, (_, i) => ({
      number: i + 1,
      hasSub: true,
      hasDub: true,
    }))
    console.log(`[gogoanime] Generated ${episodes.length} episodes from AniList for ${slug}`)
    return episodes
  },

  async getProviders(slug, ep, anilistId) {
    if (!slug) return []
    return [{ name: 'gogoanime-sub', type: 'sub' }, { name: 'gogoanime-dub', type: 'dub' }]
  },

  async getStream(slug, ep, providerName, type, anilistId, opts = {}) {
    if (!slug) return null
    if (!providerName || !providerName.startsWith('gogoanime-')) return null
    slug = await resolveGogoSlug(slug, anilistId)
    const epNum = Number(ep) || 1

    // gogoanime.by uses ONE canonical URL for both sub and dub:
    //   /slug-episode-N-english-subbed/
    // Dub players are on the SAME page, accessed via server buttons in
    // the #w-servers area. The old -english-dubbed/ URL format does
    // NOT exist, so trying it just redirects to the homepage. Always
    // load the subbed page and let cf-harvester click the correct
    // server (sub or dub) before extracting the stream.
    const preferDub = type === 'dub'
    const urls = [
      `${BASE}/${slug}-episode-${epNum}-english-subbed/`,
      `${BASE}/${slug}-episode-${epNum}/`,
    ]

    for (const watchUrl of urls) {
      // Cheap pre-flight first: if this slug isn't on the mirror, its URL
      // redirects to the homepage — skip the expensive browser extraction
      // so a provider attempt fails in ~2s instead of ~30s.
      const onMirror = await episodeOnMirror(watchUrl, slug)
      if (!onMirror) {
        console.log(`[gogoanime] ${slug} not on mirror (pre-flight miss) — skipping ${watchUrl}`)
        continue
      }
      console.log(`[gogoanime] Trying: ${watchUrl}${preferDub ? ' (preferDub)' : ''}`)
      try {
        const data = await extractStreamFromWatchPage(watchUrl, { preferDub, signal: opts.signal })
        if (data && data.sources && data.sources.length > 0) {
          const streamUrl = data.sources[0].url
          console.log(`[gogoanime] Stream extracted: ${streamUrl.slice(0, 80)}`)
          return {
            url: streamUrl, raw: streamUrl,
            headers: { Referer: watchUrl },
            tracks: (data.tracks || []).map(t => ({
              file: t.file || t.url || '', label: t.label || '',
              kind: t.kind || 'captions', default: t.default || false,
            })),
          }
        }
      } catch (e) { console.warn(`[gogoanime] URL failed ${watchUrl}:`, e.message) }
    }
    console.warn(`[gogoanime] All URL formats failed for ${slug}/${epNum}/${type}`)
    return null
  },
}
