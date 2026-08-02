// Recent searches — a small localStorage-backed list shown when the search
// box is empty. Stored as plain strings; deduped on insert; capped at 8.

const KEY = 'kurodo-recent-searches'
const MAX = 8

export function loadRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function pushRecentSearch(query: string): string[] {
  const q = query.trim()
  if (!q) return loadRecentSearches()
  const list = loadRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())
  list.unshift(q)
  const trimmed = list.slice(0, MAX)
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)) } catch { /* quota */ }
  return trimmed
}

export function removeRecentSearch(query: string): string[] {
  const list = loadRecentSearches().filter((x) => x.toLowerCase() !== query.toLowerCase())
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* quota */ }
  return list
}

export function clearRecentSearches(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
