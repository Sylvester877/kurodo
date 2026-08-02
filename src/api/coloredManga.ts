// Colored manga detection — discovers and maps colored chapters across
// MangaDex and atsu.moe. Used by the edition toggle on manga detail pages
// and the global colored-manga discovery section.

import { getChapterFeed as getMangaDexChapters } from './mangadex'
import { getChapterFeed as getAtsuChapters } from './atsu'

// ── Detection helpers ──

const COLORED_PATTERN = /colou?red|full.?color|official.?color|digital/i

/** Check if a single chapter's metadata indicates it's a colored release. */
export function isColoredChapter(ch: {
  title?: string | null
  scanGroup?: string | null
}): boolean {
  const text = [ch.title, ch.scanGroup].filter(Boolean).join(' ').toLowerCase()
  return COLORED_PATTERN.test(text)
}

// ── API helpers ──

export interface ColoredEditionInfo {
  /** Whether ANY colored chapters exist for this manga. */
  hasColored: boolean
  /** Set of chapter numbers (parsed as floats) that have a colored version. */
  coloredChapters: Set<number>
  /** Which source provided the colored data. */
  source: 'mangadex' | 'atsu'
  /** Total colored chapter count. */
  count: number
}

/** Simple in-memory cache to avoid re-fetching the same manga repeatedly.
 *  Entry expires after 30 minutes. */
const cache = new Map<string, { data: ColoredEditionInfo; at: number }>()
const CACHE_TTL = 30 * 60 * 1000

/**
 * Check if a manga has colored chapters available on MangaDex.
 * Fetches the full English chapter list and scans for colored indicators.
 */
export async function hasColoredEditionMangaDex(
  mangaId: string,
): Promise<ColoredEditionInfo> {
  const cacheKey = `md-${mangaId}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data

  try {
    const feed = await getMangaDexChapters(mangaId, 'en', 500)
    const coloredChapters = new Set<number>()
    for (const ch of feed.chapters) {
      if (isColoredChapter({ title: ch.title, scanGroup: ch.scanGroup })) {
        const num = parseFloat(ch.chapter)
        if (!isNaN(num)) coloredChapters.add(num)
      }
    }
    const result: ColoredEditionInfo = {
      hasColored: coloredChapters.size > 0,
      coloredChapters,
      source: 'mangadex',
      count: coloredChapters.size,
    }
    cache.set(cacheKey, { data: result, at: Date.now() })
    return result
  } catch {
    return {
      hasColored: false,
      coloredChapters: new Set(),
      source: 'mangadex',
      count: 0,
    }
  }
}

/**
 * Check if a manga has colored chapters available on atsu.moe.
 */
export async function hasColoredEditionAtsu(
  atsuId: string,
): Promise<ColoredEditionInfo> {
  const cacheKey = `atsu-${atsuId}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data

  try {
    const feed = await getAtsuChapters(atsuId)
    const coloredChapters = new Set<number>()
    for (const ch of feed.chapters) {
      if (isColoredChapter({ title: ch.title, scanGroup: ch.scanGroup })) {
        const num = parseFloat(ch.chapter)
        if (!isNaN(num)) coloredChapters.add(num)
      }
    }
    const result: ColoredEditionInfo = {
      hasColored: coloredChapters.size > 0,
      coloredChapters,
      source: 'atsu',
      count: coloredChapters.size,
    }
    cache.set(cacheKey, { data: result, at: Date.now() })
    return result
  } catch {
    return {
      hasColored: false,
      coloredChapters: new Set(),
      source: 'atsu',
      count: 0,
    }
  }
}

/**
 * Check colored availability from the best known source for a manga.
 * Tries MangaDex first, then atsu.moe if a MangaDex ID isn't available.
 */
export async function hasColoredEdition(
  source: 'mangadex' | 'atsu',
  id: string,
): Promise<ColoredEditionInfo> {
  if (source === 'atsu') return hasColoredEditionAtsu(id)
  return hasColoredEditionMangaDex(id)
}

/**
 * Get a chapter-number → has-colored-version map for fast lookups.
 * Returns a Record where keys are chapter numbers (as strings) and
 * values are booleans. Chapters without a colored version are absent
 * from the record (treat as false).
 */
export async function getColoredChapterMap(
  source: 'mangadex' | 'atsu',
  id: string,
): Promise<Record<string, boolean>> {
  const info = await hasColoredEdition(source, id)
  const map: Record<string, boolean> = {}
  for (const num of info.coloredChapters) {
    map[String(num)] = true
  }
  return map
}

/**
 * Curated list of popular manga known to have official colored editions.
 * Used as a starting point for the global colored-manga discovery section.
 * Each entry has known MangaDex or atsu.moe IDs for colored editions.
 */
export const KNOWN_COLORED_MANGA: Array<{
  title: string
  mangaDexId?: string
  atsuId?: string
  coverHint?: string
}> = [
  { title: 'One Piece', atsuId: 'sVC2A' },
  { title: 'Dragon Ball', atsuId: 'hE2YB' },
  { title: 'Dragon Ball Z' },
  { title: 'JoJo no Kimyou na Bouken' },
  { title: 'Naruto' },
  { title: 'Bleach' },
  { title: 'Sakamoto Days' },
  { title: 'Chainsaw Man' },
  { title: 'Jujutsu Kaisen' },
  { title: 'Kaiju No. 8' },
  { title: 'Spy x Family' },
  { title: 'Solo Leveling' },
  { title: 'One Punch Man' },
]
