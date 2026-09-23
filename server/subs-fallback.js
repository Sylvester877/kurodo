// server/subs-fallback.js — cross-provider subtitle fallback for /subs.
//
// fixes: embedded subtitle mirror hosts die independently of stream hosts
//        (cdn.watching.onl became a parked domain while streams kept
//        working). The SAME episode's dub-timed tracks ship on OTHER
//        providers' mirrors — same show, same episode, same audio sync by
//        construction.
//
// v2 — fixes: the first version fanned out PER DEAD TRACK. A 21-track
//        episode fired 21 × 35s router races simultaneously → provider
//        cooldowns → fan-outs failed → cues stayed 0. Now: ONE fan-out per
//        (show, ep, type) caches the alt provider's whole track list, and
//        each dead track is matched to its language by label. Concurrent
//        requesters share the same in-flight fan-out promise.

import { routedGetStream } from './providers/router.js'

const LIST_TTL = 10 * 60 * 1000 // 10min — mirrors come and go
const LIST_NEG_TTL = 2 * 60 * 1000
const BUF_TTL = 60 * 60 * 1000 // fetched track buffers live 1h per deadUrl

const listCache = new Map() // ctxKey -> { at, list } | { at, negative: true }
const bufCache = new Map() // deadUrl -> { at, buf } | { at, negative: true }
const inFlightFanout = new Map() // ctxKey -> Promise<list>

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

// Fan out to other providers ONCE per (show, ep, type); return their track
// list [{ label, lang, url, headers }] from the first provider that has any.
async function fanoutTrackList({ anilistId, malId, slug, ep, type, title }) {
  const ctxKey = `${slug || anilistId || malId}:${ep}:${type}`
  const cached = listCache.get(ctxKey)
  if (cached) {
    if (cached.list && Date.now() - cached.at < LIST_TTL) return cached.list
    if (cached.negative && Date.now() - cached.at < LIST_NEG_TTL) return []
  }
  const existing = inFlightFanout.get(ctxKey)
  if (existing) return existing

  const promise = (async () => {
    console.log(`[subs-fallback] cross-provider fan-out for ${slug || anilistId || malId} ep ${ep} ${type}`)
    for (const provider of PROVIDER_GUESS_ORDER.slice(0, 4)) {
      try {
        const stream = await routedGetStream(
          anilistId, slug, ep, provider, type,
          { anilistId, malId },
          title,
          undefined,
        )
        const list = (stream?.subtitles || [])
          .filter((s) => s.file)
          .map((s) => ({ label: String(s.label || ''), lang: String(s.lang || ''), url: s.file, headers: stream?.headers || null }))
        if (list.length) {
          console.log(`[subs-fallback] ✓ ${provider} has ${list.length} tracks for ep ${ep}`)
          listCache.set(ctxKey, { at: Date.now(), list })
          inFlightFanout.delete(ctxKey)
          return list
        }
      } catch {
        // provider cooled down / no stream — try the next one
      }
    }
    console.log('[subs-fallback] no provider offered tracks for this episode')
    listCache.set(ctxKey, { at: Date.now(), negative: true })
    inFlightFanout.delete(ctxKey)
    return []
  })()

  inFlightFanout.set(ctxKey, promise)
  return promise
}

function pickForLabel(list, label) {
  if (!list.length) return null
  const norm = (s) => String(s || '').toLowerCase()
  const want = norm(label)
  if (want) {
    const exact = list.find((t) => norm(t.label) === want)
    if (exact) return exact
    const partial = list.find((t) => norm(t.label).includes(want) || want.includes(norm(t.label)))
    if (partial) return partial
  }
  // no/unknown label — prefer English, else first
  const en = list.find((t) => /english/i.test(t.label) || norm(t.lang) === 'en')
  return en || list[0]
}

export async function subsCrossProviderFallback({ anilistId, malId, slug, ep, type, deadUrl, title, label }) {
  if (!ep || (!anilistId && !slug && !malId)) return null

  const bufCached = bufCache.get(deadUrl)
  if (bufCached) {
    if (bufCached.buf && Date.now() - bufCached.at < BUF_TTL) return { buf: bufCached.buf }
    if (bufCached.negative && Date.now() - bufCached.at < LIST_NEG_TTL) return null
  }

  const list = await fanoutTrackList({ anilistId, malId, slug, ep, type, title })
  const pick = pickForLabel(list, label)
  if (!pick || pick.url === deadUrl) {
    bufCache.set(deadUrl, { at: Date.now(), negative: true })
    return null
  }

  const buf = await fetchSubBuffer(pick.url, pick.headers)
  if (buf) {
    console.log(`[subs-fallback] ✓ mirror track "${pick.label}" served ${buf.length}b for ep ${ep}`)
    bufCache.set(deadUrl, { at: Date.now(), buf })
    return { buf }
  }
  bufCache.set(deadUrl, { at: Date.now(), negative: true })
  return null
}
