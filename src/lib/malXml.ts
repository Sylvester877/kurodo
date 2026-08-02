// MAL XML export parser — turns MyAnimeList's XML export into a list of
// minimal anime stubs that can be enriched later (or immediately via Jikan).

import type { PlaylistStatus } from '../store/useWatchListStore'

export interface MalXmlEntry {
  malId: number
  title: string
  type: string
  episodes: number | null
  status: number // 1=watching, 2=completed, 3=onhold, 4=dropped, 6=planToWatch
  watchedEpisodes: number
  score: number
}

/** Map MAL numeric status → our internal PlaylistStatus. */
export function malStatusToPlaylist(status: number): PlaylistStatus {
  switch (status) {
    case 1: return 'WATCHING'
    case 2: return 'COMPLETED'
    case 3: return 'ON_HOLD'
    case 4: return 'DROPPED'
    case 6: return 'PLAN_TO_WATCH'
    default: return 'PLAN_TO_WATCH'
  }
}

export interface MalPlaylistSummary {
  entries: MalXmlEntry[]
  counts: Record<PlaylistStatus, number>
  total: number
}

/** Summarize a parsed MAL export by playlist category. Used by the
 *  Import Playlist dialog to show a per-status breakdown before the
 *  user commits to importing. */
export function summarizeMalXml(xmlText: string): MalPlaylistSummary {
  const entries = parseMalXml(xmlText)
  const counts: Record<PlaylistStatus, number> = {
    CURRENT: 0, PLANNING: 0, COMPLETED: 0, DROPPED: 0, PAUSED: 0, REPEATING: 0,
    WATCHING: 0, ON_HOLD: 0, PLAN_TO_WATCH: 0,
  }
  for (const e of entries) {
    counts[malStatusToPlaylist(e.status)]++
  }
  return { entries, counts, total: entries.length }
}

/**
 * Parse a MyAnimeList XML export string into entries.
 * MAL XML format:
 *   <anime>
 *     <series_animedb_id>21</series_animedb_id>
 *     <series_title>One Piece</series_title>
 *     <series_type>TV</series_type>
 *     <series_episodes>0</series_episodes>
 *     <my_watched_episodes>0</my_watched_episodes>
 *     <my_status>6</my_status>
 *     <my_score>0</my_score>
 *   </anime>
 */
export function parseMalXml(xmlText: string): MalXmlEntry[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')

  // Check for parser error
  const parserError = doc.querySelector('parsererror')
  if (parserError) throw new Error('Invalid XML file')

  const entries: MalXmlEntry[] = []
  const animeNodes = doc.querySelectorAll('anime')

  for (const node of animeNodes) {
    const malId = Number(node.querySelector('series_animedb_id')?.textContent?.trim())
    if (!malId || isNaN(malId)) continue

    const title = node.querySelector('series_title')?.textContent?.trim() || ''
    const type = node.querySelector('series_type')?.textContent?.trim() || 'TV'
    const epText = node.querySelector('series_episodes')?.textContent?.trim() || '0'
    const episodes = epText === '0' ? null : Number(epText)
    const status = Number(node.querySelector('my_status')?.textContent?.trim()) || 6
    const watchedEpisodes = Number(node.querySelector('my_watched_episodes')?.textContent?.trim()) || 0
    const score = Number(node.querySelector('my_score')?.textContent?.trim()) || 0

    entries.push({ malId, title, type, episodes, status, watchedEpisodes, score })
  }

  return entries
}

/**
 * Convert MAL XML status codes to human-readable strings.
 */
export function malStatusLabel(status: number): string {
  switch (status) {
    case 1: return 'Watching'
    case 2: return 'Completed'
    case 3: return 'On Hold'
    case 4: return 'Dropped'
    case 6: return 'Plan to Watch'
    default: return 'Unknown'
  }
}
