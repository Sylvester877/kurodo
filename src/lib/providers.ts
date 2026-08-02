export interface ProviderMeta {
  name: string; label: string; hint?: string; priority: number; recommended?: boolean
}
export const PROVIDER_META: Record<string, ProviderMeta> = {
  // ── Only anidap servers remain (Jun 2026) ──
  // miruro: TLS cert REVOKED, consumet: 301 redirect (dead),
  // saturn: HTML-only, animdl: Python 3.14 can't build native deps
  yuki:   { name: 'yuki',   label: 'Yuki ★',   hint: '1080p • Fastest',                   priority: 0, recommended: true },
  mimi:   { name: 'mimi',   label: 'Mimi',     hint: 'Fast • Hard sub',                    priority: 1 },
  mochi:  { name: 'mochi',  label: 'Mochi',    hint: 'High Quality',                       priority: 1 },
  koto:   { name: 'koto',   label: 'Koto',     hint: 'Speed (vcdn)',                       priority: 2 },
  nuri:   { name: 'nuri',   label: 'Nuri',     hint: 'Speed (vcdn)',                       priority: 2 },
  kami:   { name: 'kami',   label: 'Kami',     hint: 'Reliable',                           priority: 3 },
  beep:   { name: 'beep',   label: 'Beep',     hint: 'Soft sub, Fast',                     priority: 3 },
  neko:   { name: 'neko',   label: 'Neko',     hint: 'Alternative',                        priority: 4 },
  miku:   { name: 'miku',   label: 'Miku',     hint: 'Alternative',                        priority: 4 },
  shiro:  { name: 'shiro',  label: 'Shiro',    hint: 'Region variety',                     priority: 5 },
  wave:   { name: 'wave',   label: 'Wave',     hint: 'Region variety',                     priority: 5 },
}
export function getProviderMeta(name: string): ProviderMeta {
  // Handle prefixed names from the server. The backend prefixes server
  // names with a provider-family tag (e.g. "anidap-Yuki", "miruro-MegaCloud").
  // Strip the family prefix FIRST, then do a case-insensitive lookup in
  // PROVIDER_META. Also try the raw unprefixed name as a fallback.
  const cleaned = name.replace(/^anidap-/i, '').toLowerCase()
  const meta = PROVIDER_META[cleaned]
  if (meta) return meta
  // Fallback: try the first segment (for unprefixed names like "pahe")
  const firstSeg = name.split('-')[0].toLowerCase()
  return PROVIDER_META[firstSeg] ?? { name, label: name.charAt(0).toUpperCase() + name.slice(1), priority: 99 }
}
export function sortProviders<T extends { name: string; default?: boolean }>(list: T[]): T[] {
  // Priority is the primary key; alphabetic-by-name is the tie-breaker.
  // Without a tie-breaker, two servers sharing the same priority (and no
  // `default` flag) would be ordered by V8's internal sort, which is
  // not guaranteed stable across browsers / engines — and the user has
  // reported servers "shuffling" on every page load. This makes order
  // both deterministic AND consistent across sessions.
  return [...list].sort((a, b) => {
    const pa = getProviderMeta(a.name).priority
    const pb = getProviderMeta(b.name).priority
    if (pa !== pb) return pa - pb
    // Tie: default first, then alphabetic by lower-cased name.
    const da = a.default ? 0 : 1
    const db = b.default ? 0 : 1
    if (da !== db) return da - db
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  })
}
export function pickPreferredProvider<T extends { name: string }>(list: T[], prefer?: string): T | null {
  if (!list.length) return null
  if (prefer && prefer !== 'auto') {
    const lower = prefer.toLowerCase()
    // 1. Exact match on full name (e.g. 'miruro-megacloud')
    const exact = list.find(p => p.name.toLowerCase() === lower)
    if (exact) return exact
    // 2. Starts-with match (e.g. prefer='miruro' matches 'miruro-MegaCloud')
    const starts = list.find(p => p.name.toLowerCase().startsWith(lower))
    if (starts) return starts
    // 3. Match against the cleaned name (strip provider-family prefix like
    //    anidap-/miruro-/saturn-/pahe- → then case-insensitive compare).
    //    This lets users pick a specific server like 'yuki' and match
    //    'anidap-Yuki' or 'miruro-Yuki'.
    const cleanMatch = list.find(p => {
      const clean = p.name.replace(/^anidap-/i, '').toLowerCase()
      return clean === lower || clean.startsWith(lower)
    })
    if (cleanMatch) return cleanMatch
  }
  const sorted = sortProviders(list)
  return sorted[0] || null
}
