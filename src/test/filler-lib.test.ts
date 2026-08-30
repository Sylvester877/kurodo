// Unit tests for the pure filler logic (server/filler-lib.js).
//
// Covers the two things the bug-hunt pass cared about:
//   1. Every source path reports its `source` field ('afl' / 'jikan') so the
//      /api/filler response is self-describing.
//   2. Route behavior: AFL-first ordering, Jikan fallback, success cache,
//      and the title-aware negative cache (empty-title misses must NOT
//      poison the key — the bug that made filler 404 for 5 minutes).
//
// These are pure-function tests: no server boot, no network, no jsdom needed.

import { describe, it, expect, vi } from 'vitest'
import {
  aflSlugify,
  parseAFLPage,
  buildJikanFiller,
  resolveFiller,
  FILLER_CACHE_TTL,
  FILLER_FAIL_TTL,
} from '../../server/filler-lib.js'

// ── Sample AFL page: Bleach-style ranges with the real onclick format ──
// Real AnimeFillerList markup: <a onclick="jumpToNum(1);">1-7</a> (semicolon
// after the call). The parser must match this exact format.
const BLEACH_AFL_HTML = `
<div class="manga_canon"><span class="Label">Manga Canon Episodes:</span><span class="Episodes">
<a onclick="jumpToNum(1);">1-7</a>, <a onclick="jumpToNum(8);">8-9</a>
</span></div>
<div class="anime_canon"><span class="Label">Anime Canon Episodes:</span><span class="Episodes">
<a onclick="jumpToNum(10);">10-63</a>
</span></div>
<div class="mixed_canon/filler"><span class="Label">Mixed Canon/Filler Episodes:</span><span class="Episodes">
<a onclick="jumpToNum(64);">64-108</a>
</span></div>
<div class="filler"><span class="Label">Filler Episodes:</span><span class="Episodes">
<a onclick="jumpToNum(109);">109-113</a>, <a onclick="jumpToNum(114);">114</a>
</span></div>
`

describe('aflSlugify', () => {
  it('kebab-cases a title', () => {
    expect(aflSlugify('Naruto Shippuden')).toBe('naruto-shippuden')
    expect(aflSlugify('Bleach: Thousand-Year Blood War')).toBe('bleach-thousand-year-blood-war')
  })

  it('strips leading/trailing separators and non-alphanumerics', () => {
    expect(aflSlugify('  Attack on Titan!! ')).toBe('attack-on-titan')
    expect(aflSlugify('One-Piece_')).toBe('one-piece')
  })

  it('returns empty string for empty/derivative input', () => {
    expect(aflSlugify('')).toBe('')
    expect(aflSlugify(null as unknown as string)).toBe('')
  })
})

/** Inclusive range helper [a..b]. */
function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

describe('parseAFLPage', () => {
  it('expands ranges into sorted episode arrays and sets source=afl', () => {
    const out = parseAFLPage(BLEACH_AFL_HTML)
    expect(out).not.toBeNull()
    expect(out!.source).toBe('afl')
    expect(out!.total_episodes).toBe(114)
    expect(out!.canon_episodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(out!.anime_canon_episodes).toEqual(range(10, 63))
    expect(out!.mixed_episodes).toEqual(range(64, 108))
    expect(out!.filler_episodes).toEqual([...range(109, 113), 114])
  })

  it('handles single-episode anchors (no range dash)', () => {
    const html = '<div class="filler"><span class="Label">F:</span><span class="Episodes"><a onclick="jumpToNum(5);">5</a></span></div>'
    const out = parseAFLPage(html)
    expect(out!.filler_episodes).toEqual([5])
    expect(out!.total_episodes).toBe(5)
  })

  it('returns null for pages with no episode data', () => {
    expect(parseAFLPage('<html><body>not a show page</body></html>')).toBeNull()
    expect(parseAFLPage('')).toBeNull()
  })

  it('returns null when class names are missing (parser anchor requires the Episodes span)', () => {
    const html = '<div class="filler"><span class="Label">Filler:</span><span>no episodes span</span></div>'
    expect(parseAFLPage(html)).toBeNull()
  })
})

describe('buildJikanFiller', () => {
  it('builds the response shape with source=jikan', () => {
    const flags = new Map<number, { filler: boolean; recap: boolean }>([
      [1, { filler: false, recap: false }],
      [2, { filler: true, recap: false }],
      [3, { filler: true, recap: true }],
      [4, { filler: false, recap: false }],
    ])
    const out = buildJikanFiller(flags, 4)
    expect(out).not.toBeNull()
    expect(out!.source).toBe('jikan')
    expect(out!.total_episodes).toBe(4)
    expect(out!.filler_episodes).toEqual([2, 3])
    expect(out!.recap_episodes).toEqual([3])
    expect(out!.canon_episodes).toEqual([])
  })

  it('returns null when no flags were collected (Jikan empty)', () => {
    expect(buildJikanFiller(new Map(), 0)).toBeNull()
    expect(buildJikanFiller(null as unknown as Map<number, { filler: boolean; recap: boolean }>, 0)).toBeNull()
  })

  it('sorts episode numbers ascending regardless of insertion order', () => {
    const flags = new Map<number, { filler: boolean; recap: boolean }>([
      [50, { filler: true, recap: false }],
      [3, { filler: true, recap: false }],
      [120, { filler: true, recap: false }],
    ])
    const out = buildJikanFiller(flags, 120)
    expect(out!.filler_episodes).toEqual([3, 50, 120])
  })
})

describe('resolveFiller — route decision logic', () => {
  // Small helpers for building a fresh cache state per test
  const freshCaches = () => ({
    cache: new Map<string, { at: number; data: Filler }>(),
    failCache: new Map<string, { at: number; slug: string }>(),
  })

  type Filler = { total_episodes: number; filler_episodes: number[]; canon_episodes: number[]; anime_canon_episodes: number[]; mixed_episodes: number[]; source?: string }
  const aflData: Filler = { total_episodes: 366, filler_episodes: [1], canon_episodes: [], anime_canon_episodes: [], mixed_episodes: [], source: 'afl' }
  const jikanData: Filler = { total_episodes: 28, filler_episodes: [7], canon_episodes: [], anime_canon_episodes: [], mixed_episodes: [], source: 'jikan' }
  type AFLFn = (title: string) => Promise<Filler | null>
  type JikanFn = (malId: number) => Promise<Filler | null>
  type LegacyFn = (title: string, malId: number) => Promise<Filler | null>

  it('serves AFL data first when the scraper succeeds (source=afl)', async () => {
    const { cache, failCache } = freshCaches()
    const fetchAFL = vi.fn(async () => aflData)
    const fetchJikan = vi.fn(async () => jikanData)
    const result = await resolveFiller({
      malId: 269, title: 'Bleach', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(result.status).toBe(200)
    if (result.status === 200) {
      expect(result.data).toBe(aflData)
      expect(result.source).toBe('afl')
    }
    expect(fetchAFL).toHaveBeenCalledWith('Bleach')
    expect(fetchJikan).not.toHaveBeenCalled()
  })

  it('falls back to Jikan when AFL fails (source=jikan)', async () => {
    const { cache, failCache } = freshCaches()
    const fetchAFL = vi.fn(async () => null)
    const fetchJikan = vi.fn(async () => jikanData)
    const result = await resolveFiller({
      malId: 52991, title: 'Frieren: Beyond Journey\'s End', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(result.status).toBe(200)
    if (result.status === 200) {
      expect(result.data).toBe(jikanData)
      expect(result.source).toBe('jikan')
    }
  })

  it('skips the AFL scrape entirely for empty-title requests', async () => {
    const { cache, failCache } = freshCaches()
    const fetchAFL = vi.fn(async () => aflData)
    const fetchJikan = vi.fn(async () => jikanData)
    await resolveFiller({
      malId: 269, title: '', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(fetchAFL).not.toHaveBeenCalled()
  })

  it('serves from the success cache without re-running fetchers', async () => {
    const { cache, failCache } = freshCaches()
    cache.set('filler:269', { at: Date.now(), data: aflData })
    const fetchAFL = vi.fn(async () => aflData)
    const fetchJikan = vi.fn(async () => jikanData)
    const result = await resolveFiller({
      malId: 269, title: 'Bleach', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(result.status).toBe(200)
    if (result.status === 200) {
      expect(result.hit).toBe(true)
      expect(result.data).toBe(aflData)
    }
    expect(fetchAFL).not.toHaveBeenCalled()
    expect(fetchJikan).not.toHaveBeenCalled()
  })

  it('ignores a stale success-cache entry (past TTL) and refetches', async () => {
    const { cache, failCache } = freshCaches()
    cache.set('filler:269', { at: Date.now() - FILLER_CACHE_TTL - 1000, data: { ...aflData, filler_episodes: [999] } })
    const fetchAFL = vi.fn(async () => aflData)
    const result = await resolveFiller({
      malId: 269, title: 'Bleach', cache, failCache,
      fetchAFL,
    })
    expect(result.status).toBe(200)
    if (result.status === 200) expect(result.data).toBe(aflData)
    expect(fetchAFL).toHaveBeenCalled()
  })

  it('does NOT poison the negative cache on an empty-title 404', async () => {
    const { cache, failCache } = freshCaches()
    const fetchAFL = vi.fn<AFLFn>(async () => null)
    const fetchJikan = vi.fn<JikanFn>(async () => null)
    // no-title request → 404
    const result = await resolveFiller({
      malId: 269, title: '', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(result.status).toBe(404)
    // Key must NOT be in the fail cache — a titled request right after must
    // still be able to resolve (this was the original 5-minute-poisoning bug).
    expect(failCache.has('filler:269')).toBe(false)
    // And a subsequent TITLED request works fine
    fetchAFL.mockResolvedValueOnce(aflData)
    const retry = await resolveFiller({
      malId: 269, title: 'Bleach', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(retry.status).toBe(200)
  })

  it('poisons the negative cache ONLY for titled misses, and only for the same slug', async () => {
    const { cache, failCache } = freshCaches()
    const fetchAFL = vi.fn<AFLFn>(async () => null)
    const fetchJikan = vi.fn<JikanFn>(async () => null)
    // Titled miss → 404 + fail cache set with the slug
    const miss = await resolveFiller({
      malId: 269, title: 'Bleach', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(miss.status).toBe(404)
    const failed = failCache.get('filler:269')
    expect(failed).toBeDefined()
    expect(failed!.slug).toBe('bleach')
    expect(Date.now() - failed!.at).toBeLessThan(FILLER_FAIL_TTL)

    // Same title again → fast negative-cache 404, no fetcher calls
    const hit = await resolveFiller({
      malId: 269, title: 'Bleach', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(hit.status).toBe(404)
    if (hit.status === 404) expect(hit.negativeHit).toBe(true)
    expect(fetchAFL).toHaveBeenCalledTimes(1) // only from the first miss
    expect(fetchJikan).toHaveBeenCalledTimes(1)

    // A DIFFERENT (correct) title with the same malId bypasses the negative
    // cache because the slug differs → allowed to retry
    fetchAFL.mockResolvedValueOnce(aflData)
    const retry = await resolveFiller({
      malId: 269, title: 'Bleach: Thousand-Year Blood War', cache, failCache,
      fetchAFL, fetchJikan,
    })
    expect(retry.status).toBe(200)
  })

  it('ignores an expired negative-cache entry (past TTL)', async () => {
    const { cache, failCache } = freshCaches()
    failCache.set('filler:269', { at: Date.now() - FILLER_FAIL_TTL - 1000, slug: 'bleach' })
    const fetchAFL = vi.fn(async () => aflData)
    const result = await resolveFiller({
      malId: 269, title: 'Bleach', cache, failCache,
      fetchAFL,
    })
    expect(result.status).toBe(200)
    expect(fetchAFL).toHaveBeenCalled()
  })

  it('falls back to the legacy fetcher when AFL and Jikan both miss', async () => {
    const { cache, failCache } = freshCaches()
    const legacyData: Filler = { total_episodes: 100, filler_episodes: [5], canon_episodes: [], anime_canon_episodes: [], mixed_episodes: [], source: 'legacy' }
    const fetchLegacy = vi.fn<LegacyFn>(async () => legacyData)
    const result = await resolveFiller({
      malId: 42, title: 'Some Show', cache, failCache,
      fetchAFL: async () => null,
      fetchJikan: async () => null,
      fetchLegacy,
    })
    expect(result.status).toBe(200)
    if (result.status === 200) expect(result.data).toBe(legacyData)
  })

  it('returns 404 and caches the failure when every source misses (titled request)', async () => {
    const { cache, failCache } = freshCaches()
    const result = await resolveFiller({
      malId: 42, title: 'No Such Anime', cache, failCache,
      fetchAFL: async () => null,
      fetchJikan: async () => null,
      fetchLegacy: async () => null,
    })
    expect(result.status).toBe(404)
    expect(failCache.get('filler:42')?.slug).toBe('no-such-anime')
  })
})
