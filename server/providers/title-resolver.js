// title-resolver.js — shared utility for resolving AniList IDs to titles.
//
// Different anime sites use different naming conventions:
//   - English: "Bleach: Thousand-Year Blood War"
//   - Romaji:  "Bleach: Sennen Kessen-hen"
//   - Native:  "BLEACH 千年血戦篇"
//
// Providers that search by title need to try ALL variants in order
// until a match is found. This module fetches all three from AniList
// and returns them in a priority-ordered array so callers can iterate.

import axios from 'axios'

/**
 * Fetches all known title variants for an AniList anime ID.
 * Returns them in recommended search order:
 *   romaji → english → native
 *
 * Romaji is first because most scraper sites use romanized titles
 * as their canonical search index. English is second for sites that
 * prefer "Attack on Titan" over "Shingeki no Kyojin". Native Japanese
 * is last-resort for sites that accept kana/kanji search.
 *
 * Results are cached in-memory for 30 minutes with automatic eviction
 * when the cache exceeds 500 entries.
 */
const titleCache = new Map()
const TITLE_TTL = 30 * 60 * 1000
const TITLE_CACHE_MAX = 500

function pruneTitleCache() {
  if (titleCache.size <= TITLE_CACHE_MAX) return
  const now = Date.now()
  // Remove expired entries first
  for (const [k, v] of titleCache) {
    if (now - v.at > TITLE_TTL) titleCache.delete(k)
  }
  // If still over limit, drop oldest 25%
  if (titleCache.size > TITLE_CACHE_MAX) {
    const entries = Array.from(titleCache.entries())
      .sort((a, b) => a[1].at - b[1].at)
    const drop = Math.floor(entries.length / 4)
    for (let i = 0; i < drop; i++) {
      titleCache.delete(entries[i][0])
    }
  }
}

/**
 * @param {number} anilistId
 * @returns {Promise<{titles: string[], malId: number|null}>}
 */
export async function fetchAnimeTitles(anilistId) {
  if (!anilistId) return { titles: [], malId: null }

  const cached = titleCache.get(anilistId)
  if (cached && Date.now() - cached.at < TITLE_TTL) {
    return { titles: cached.titles, malId: cached.malId }
  }

  try {
    const { data } = await axios.post(
      'https://graphql.anilist.co',
      {
        query: 'query ($id: Int) { Media(id: $id, type: ANIME) { idMal title { romaji english native } } }',
        variables: { id: Number(anilistId) },
      },
      { timeout: 6000, headers: { 'Content-Type': 'application/json' } },
    )

    const media = data?.data?.Media
    const romaji = media?.title?.romaji || null
    const english = media?.title?.english || null
    const native = media?.title?.native || null
    const malId = media?.idMal || null

    // Deduplicate (romaji and english are often the same) and filter nulls
    const seen = new Set()
    const titles = [romaji, english, native].filter(Boolean).filter(t => {
      const lower = t.toLowerCase().trim()
      if (seen.has(lower)) return false
      seen.add(lower)
      return true
    })

    const result = { titles, malId }
    titleCache.set(anilistId, { at: Date.now(), ...result })
    pruneTitleCache()
    return result
  } catch {
    return { titles: [], malId: null }
  }
}

/**
 * Searches a provider using fuzzy title matching.
 * Tries each title variant in order until a result with at least one match is found.
 *
 * @param {number} anilistId
 * @param {(title: string) => Promise<{results?: Array<{id: any}>} | Array<any> | null>} searchFn
 *   Search function that accepts a title string and returns results.
 * @param {Object} [opts]
 * @param {(result: any) => any} [opts.idExtractor] How to extract the ID from a result item. Default: r => r.id
 * @param {(result: any) => string} [opts.titleExtractor] How to extract the title for logging. Default: r => r.title || r.name
 * @param {(result: any, malId: number|null) => boolean} [opts.matchVerifier] Optional: verify the result actually matches (e.g., by MAL ID cross-check)
 * @returns {Promise<{id: any, title: string} | null>}
 */
export async function fuzzySearch(anilistId, searchFn, opts = {}) {
  const { idExtractor = (r) => r.id, titleExtractor = (r) => r.title || r.name, matchVerifier } = opts

  const { titles, malId } = await fetchAnimeTitles(anilistId)
  if (!titles.length) return null

  for (const title of titles) {
    try {
      const raw = await searchFn(title)
      const results = Array.isArray(raw?.results) ? raw.results : (Array.isArray(raw) ? raw : [])

      if (results.length === 0) continue

      // If we have a verifier, try to find a verified match first
      if (matchVerifier) {
        for (const r of results) {
          try {
            if (await matchVerifier(r, malId)) {
              return { id: idExtractor(r), title: titleExtractor(r) || title }
            }
          } catch { /* verification failed, try next */ }
        }
      }

      // Fallback: first result
      const first = results[0]
      return { id: idExtractor(first), title: titleExtractor(first) || title }
    } catch {
      // Try next title
      continue
    }
  }

  return null
}
