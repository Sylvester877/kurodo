// server/subs-fallback.js — cross-provider subtitle fallback for /subs.
//
// fixes: embedded subtitle mirror hosts die independently of stream hosts
//        (cdn.watching.onl became a parked domain while streams kept
//        working). The SAME episode's dub-timed tracks ship on OTHER
//        providers' mirrors — same show, same episode, same audio sync by
//        construction (all tracks are timed to the same dub master).
//
// Flow: for the failing (show, ep, type), race 2-3 OTHER providers through
// the normal stream router, collect their embedded English-track URLs,
// fetch each once through subsFetchWithRetry-grade headers, and return the
// first buffer that actually looks like a subtitle file. Results are cached
// briefly so a flaky mirror doesn't re-fan-out on every cue request.

import { routedGetStream } from './providers/router.js'

const ALT_SUBS_CACHE = new Map() // deadUrl -> { at, buf } | null-marker
const ALT_TTL = 10 * 60 * 1000 // 10min — short; mirrors come and go
const ALT_NEG_TTL = 2 * 60 * 1000 // remember "no alt found" briefly

const PROVIDER_GUESS_ORDER = [
  'anidap-mimi', 'anidap-yuki', 'anidap-sora', 'anidap-beep',
  'anidap-neko', 'anidap-kiwi', 'anidap-nuri', 'anidap-loli',
]

const SUBS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

function looksLikeSubtitles(buf) {
  const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('utf-8')
  if (/^WEBVTT/i.test(head)) return true
  if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.test(head)) return true
  if (/\d{1,2}:\d{2}[,.]\d{1,3}\s+-->\s+\d{1,2}:\d{2}[,.]\d{1,3}/.test(head)) return true
  return false
}

function srtToVtt(buf) {
  // Some mirrors ship SRT with a .vtt name — normalize so <track> parses it.
  let text = buf.toString('utf-8')
  if (/^WEBVTT/i.test(text)) return buf
  text = text.replace(/\r+\n/g, '\n')
  text = 'WEBVTT\n\n' + text.replace(/^(\d+)\n/gm, '') // drop SRT cue numbers
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
  return Buffer.from(text, 'utf-8')
}

async function fetchSubBuffer(url, headers) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 12000)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': SUBS_UA, ...(headers?.Referer ? { referer: headers.Referer } : {}) },
      redirect: 'follow',
      signal: ac.signal,
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (!buf.length || !looksLikeSubtitles(buf)) return null
    return srtToVtt(buf)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function subsCrossProviderFallback({ anilistId, malId, slug, ep, type, deadUrl, title }) {
  if (!ep || (!anilistId && !slug)) return null
  const cacheKey = deadUrl
  const cached = ALT_SUBS_CACHE.get(cacheKey)
  if (cached) {
    if (cached.buf && Date.now() - cached.at < ALT_TTL) return { buf: cached.buf }
    if (!cached.buf && Date.now() - cached.at < ALT_NEG_TTL) return null
  }

  console.log(`[subs-fallback] cross-provider fan-out for ${slug || anilistId} ep ${ep} ${type}`)
  const candidates = PROVIDER_GUESS_ORDER.slice(0, 3)

  for (const provider of candidates) {
    try {
      const stream = await routedGetStream(
        anilistId, slug, ep, provider, type,
        { anilistId, malId },
        title,
        undefined,
      )
      const subs = stream?.subtitles || []
      // fixes: every embedded track is labeled "(lang - [Full])" so a loose
      //        /full/i match returned Arabic etc. Require a real English
      //        marker: the word "english" or an explicit en lang code.
      const enUrls = subs
        .filter((s) => s.file && (/english/i.test(String(s.label || '')) || String(s.lang || '').toLowerCase() === 'en'))
        .map((s) => s.file)
      for (const url of enUrls.slice(0, 2)) {
        if (url === deadUrl) continue // that's the one that's dead
        const buf = await fetchSubBuffer(url, stream?.headers)
        if (buf) {
          console.log(`[subs-fallback] ✓ ${provider} mirror served ${buf.length}b for ep ${ep}`)
          ALT_SUBS_CACHE.set(cacheKey, { at: Date.now(), buf })
          return { buf }
        }
      }
    } catch {
      // provider cooled down / no stream — try the next one
    }
  }

  ALT_SUBS_CACHE.set(cacheKey, { at: Date.now(), buf: null })
  return null
}
