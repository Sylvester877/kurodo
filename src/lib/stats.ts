// Pure stats helpers for the /profile dashboard.
// Take WatchEvents + watchlist as input — no UI, no fetching.

import type { Anime } from '../types'
import type { WatchEvent } from '../store/useWatchListStore'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Estimate average runtime per episode for a show.
 * Jikan's `duration` is a string like "24 min per ep" or "1 hr 30 min".
 * Falls back to 24 (anime average) when unknown.
 */
export function estimateRuntimeMinutes(anime: Anime | undefined): number {
  if (!anime?.duration) return 24
  const s = anime.duration
  let total = 0
  const hr = s.match(/(\d+)\s*hr/i)
  const min = s.match(/(\d+)\s*min/i)
  if (hr) total += parseInt(hr[1], 10) * 60
  if (min) total += parseInt(min[1], 10)
  return total > 0 ? total : 24
}

// ─────────────────────────────────────────────────────────────────
// Time-window aggregates
// ─────────────────────────────────────────────────────────────────
export interface TimeStats {
  /** Total unique episodes watched. */
  episodes: number
  /** Total runtime in minutes. */
  minutes: number
  /** Distinct shows touched. */
  shows: number
}

export function aggregateStats(
  history: WatchEvent[],
  watchlistById: Map<number, Anime>,
  sinceMs?: number,
): TimeStats {
  const showSet = new Set<number>()
  let episodes = 0
  let minutes = 0
  for (const ev of history) {
    if (sinceMs && ev.at < sinceMs) continue
    episodes += 1
    showSet.add(ev.animeId)
    minutes += estimateRuntimeMinutes(watchlistById.get(ev.animeId))
  }
  return { episodes, minutes, shows: showSet.size }
}

export function statsByWindow(
  history: WatchEvent[],
  watchlist: Anime[],
): {
  allTime: TimeStats
  thisYear: TimeStats
  thisMonth: TimeStats
  thisWeek: TimeStats
} {
  const byId = new Map(watchlist.map((a) => [a.mal_id, a]))
  const now = new Date()
  const yearStart  = new Date(now.getFullYear(), 0, 1).getTime()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  // Start of the current ISO week (Mon)
  const day = (now.getDay() + 6) % 7
  const weekStart = new Date(
    now.getFullYear(), now.getMonth(), now.getDate() - day,
  ).getTime()

  return {
    allTime:   aggregateStats(history, byId),
    thisYear:  aggregateStats(history, byId, yearStart),
    thisMonth: aggregateStats(history, byId, monthStart),
    thisWeek:  aggregateStats(history, byId, weekStart),
  }
}

// ─────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────
export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)}m`
  const h = min / 60
  if (h < 24) return `${h.toFixed(1)}h`
  const d = Math.floor(h / 24)
  const rh = Math.round(h - d * 24)
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}

// ─────────────────────────────────────────────────────────────────
// Top breakdowns — genres + studios
// ─────────────────────────────────────────────────────────────────
export interface CountEntry {
  key: string
  count: number
  pct: number
}

export function topGenres(
  history: WatchEvent[],
  watchlist: Anime[],
  limit = 8,
): CountEntry[] {
  const byId = new Map(watchlist.map((a) => [a.mal_id, a]))
  const tally = new Map<string, number>()
  for (const ev of history) {
    const a = byId.get(ev.animeId)
    if (!a?.genres) continue
    for (const g of a.genres) {
      tally.set(g.name, (tally.get(g.name) ?? 0) + 1)
    }
  }
  const total = Array.from(tally.values()).reduce((s, n) => s + n, 0) || 1
  return Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count, pct: (count / total) * 100 }))
}

export function topStudios(
  watchlist: Anime[],
  limit = 6,
): CountEntry[] {
  const tally = new Map<string, number>()
  for (const a of watchlist) {
    if (!a.studios) continue
    for (const s of a.studios) {
      tally.set(s.name, (tally.get(s.name) ?? 0) + 1)
    }
  }
  const total = Array.from(tally.values()).reduce((s, n) => s + n, 0) || 1
  return Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count, pct: (count / total) * 100 }))
}

// ─────────────────────────────────────────────────────────────────
// Contribution-style heatmap (GitHub-like, ~12 weeks)
// ─────────────────────────────────────────────────────────────────
export interface HeatCell {
  date: Date
  iso: string  // YYYY-MM-DD
  count: number
  /** 0–4 intensity bucket */
  level: 0 | 1 | 2 | 3 | 4
}

/**
 * Build a 7×N grid where N = weeks back. The first column is the oldest.
 * Cells without an explicit count are zero (still present so the grid is dense).
 */
export function buildHeatmap(history: WatchEvent[], weeks = 12): HeatCell[][] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // Roll back to start of current week (Mon)
  const dayIdx = (today.getDay() + 6) % 7
  const endMonday = new Date(today)
  endMonday.setDate(endMonday.getDate() - dayIdx)
  const startMonday = new Date(endMonday)
  startMonday.setDate(endMonday.getDate() - 7 * (weeks - 1))

  // Bucket events by ISO day
  const tally = new Map<string, number>()
  for (const ev of history) {
    const d = new Date(ev.at)
    if (d < startMonday) continue
    const iso = d.toISOString().slice(0, 10)
    tally.set(iso, (tally.get(iso) ?? 0) + 1)
  }

  const max = Math.max(1, ...tally.values())
  const cells: HeatCell[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = new Date(startMonday)
      date.setDate(startMonday.getDate() + w * 7 + d)
      const iso = date.toISOString().slice(0, 10)
      const count = tally.get(iso) ?? 0
      let level: HeatCell['level'] = 0
      if (count > 0) {
        const ratio = count / max
        if (ratio < 0.25) level = 1
        else if (ratio < 0.5) level = 2
        else if (ratio < 0.75) level = 3
        else level = 4
      }
      col.push({ date, iso, count, level })
    }
    cells.push(col)
  }
  return cells
}

// ─────────────────────────────────────────────────────────────────
// Current streak (consecutive days ending today with ≥1 episode)
// ─────────────────────────────────────────────────────────────────
export function currentStreak(history: WatchEvent[]): number {
  if (history.length === 0) return 0
  const days = new Set<string>()
  for (const ev of history) {
    days.add(new Date(ev.at).toISOString().slice(0, 10))
  }
  let streak = 0
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  while (true) {
    const iso = cursor.toISOString().slice(0, 10)
    if (!days.has(iso)) break
    streak++
    cursor.setTime(cursor.getTime() - DAY_MS)
  }
  return streak
}

// ─────────────────────────────────────────────────────────────────
// In-progress shows (continueWatching + per-anime progress %)
// ─────────────────────────────────────────────────────────────────
export interface ProgressItem {
  anime: Anime
  watched: number
  total: number | null
  pct: number   // 0..100
  lastEpisode: number
}

export function buildProgressList(
  watchlist: Anime[],
  watchedEpisodes: Record<number, number[]>,
  continueWatching: Array<{ anime: Anime; episode: number; updatedAt: number }>,
): ProgressItem[] {
  // Use continueWatching for ordering (most-recent first), fall back to
  // anything in watchlist with at least one watched ep.
  const byId = new Map<number, ProgressItem>()
  for (const c of continueWatching) {
    const total = c.anime.episodes ?? null
    const watched = (watchedEpisodes[c.anime.mal_id] ?? []).length
    const pct = total && total > 0 ? Math.min(100, (watched / total) * 100) : 0
    byId.set(c.anime.mal_id, {
      anime: c.anime, watched, total, pct, lastEpisode: c.episode,
    })
  }
  for (const a of watchlist) {
    if (byId.has(a.mal_id)) continue
    const watched = (watchedEpisodes[a.mal_id] ?? []).length
    if (watched === 0) continue
    const last = Math.max(...(watchedEpisodes[a.mal_id] ?? [0]))
    const total = a.episodes ?? null
    const pct = total && total > 0 ? Math.min(100, (watched / total) * 100) : 0
    byId.set(a.mal_id, { anime: a, watched, total, pct, lastEpisode: last })
  }
  // Filter out finished shows (100%) — they belong in "Completed"
  return Array.from(byId.values()).filter((p) => p.pct < 100)
}
