export interface ProviderMeta {
  name: string; label: string; hint?: string; priority: number; recommended?: boolean
}
export const PROVIDER_META: Record<string, ProviderMeta> = {
  // ── Current chad roster (Aug 2026 re-shuffle) ──
  // The legacy multi-1080p fleet (nuri/kami/koto/mochi/vee/yume/uwu) is
  // GONE upstream — chad now serves sora/kiwi/neko/beep/mimi/yuki (verified
  // live: sora/kiwi/neko/beep masters carry a 1920x1080 variant). Hints are
  // updated from the live chad tips; priorities rank QUALITY first so the
  // best-looking stream is the default, and chad's per-episode `default`
  // flag is the tie-breaker inside a quality tier (sortProviders).
  // NOTE: the renderer no longer hardcodes this for new servers — the
  // server API now sends fresh `tip` strings from chad, and Unknown
  // servers (no entry here) get a neutral auto-derived label instead of a
  // stale one.
  sora:   { name: 'sora',   label: 'Sora',     hint: 'Soft sub, Fast, High quality',       priority: 0, recommended: true },
  kiwi:   { name: 'kiwi',   label: 'Kiwi',     hint: 'Hard sub, Fast, High quality',       priority: 0 },
  neko:   { name: 'neko',   label: 'Neko',     hint: 'Hard sub, Fast, High quality',       priority: 0 },
  beep:   { name: 'beep',   label: 'Beep',     hint: 'Soft sub, Fast',                     priority: 1 },
  mimi:   { name: 'mimi',   label: 'Mimi',     hint: 'Soft sub, Fastest',                  priority: 2 },
  yuki:   { name: 'yuki',   label: 'Yuki',     hint: 'Soft sub, Good, Multi quality',      priority: 3 },
  // ── Legacy names, kept in case upstream revives them ──
  nuri:   { name: 'nuri',   label: 'Nuri',     hint: 'Legacy',                             priority: 9 },
  kami:   { name: 'kami',   label: 'Kami',     hint: 'Legacy',                             priority: 9 },
  koto:   { name: 'koto',   label: 'Koto',     hint: 'Legacy',                             priority: 9 },
  mochi:  { name: 'mochi',  label: 'Mochi',    hint: 'Legacy',                             priority: 9 },
  miku:   { name: 'miku',   label: 'Miku',     hint: 'Legacy',                             priority: 9 },
  shiro:  { name: 'shiro',  label: 'Shiro',    hint: 'Legacy',                             priority: 9 },
  wave:   { name: 'wave',   label: 'Wave',     hint: 'Legacy',                             priority: 9 },
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
  return PROVIDER_META[firstSeg] ?? { name, label: name.charAt(0).toUpperCase() + name.slice(1), priority: 8 }
}
/** Rank an upstream tip for quality: "High quality" > everything else.
 *  Used as the FIRST sort key in sortProviders so 1080p-capable servers
 *  (sora/kiwi/neko/beep — live-verified 1080p masters) outrank 720p-only
 *  ones (mimi/yuki) even when a server has no entry in PROVIDER_META. */
function tipQualityRank(tip?: string | null): number {
  if (!tip) return 1
  const t = tip.toLowerCase()
  if (t.includes('high quality')) return 0
  if (t.includes('multi quality')) return 1
  if (t.includes('good')) return 2
  return 1
}

/** Server-health rank: verified-OK servers before unverified, dead last.
 *  The backend (server-verify.js) marks _healthy:false for servers that
 *  FAILED a live probe against THIS title (kiwi 404s, yuki/dub dead links) —
 *  they must sort to the very bottom and never win the default pick, even
 *  if their tip says "High quality". Unverified (undefined) stays neutral. */
function healthRank(p: { _healthy?: boolean | null }): number {
  if (p._healthy === false) return 2
  if (p._healthy === true) return 0
  return 1
}

export function sortProviders<T extends { name: string; default?: boolean; tip?: string | null; _healthy?: boolean | null }>(list: T[]): T[] {
  // Sort keys, in order:
  //   0. verified health (working servers first, verified-dead last)
  //   1. tip quality ("High quality" servers first — 1080p-capable ones)
  //   2. static PROVIDER_META priority (quality-ranked roster)
  //   3. chad's per-episode `default` flag
  //   4. alphabetic name — makes the order deterministic across reloads
  //      (V8's sort is not guaranteed stable; without the tie-breaker two
  //      servers sharing all keys would "shuffle" on every page load).
  return [...list].sort((a, b) => {
    const ha = healthRank(a as T & { _healthy?: boolean | null })
    const hb = healthRank(b as T & { _healthy?: boolean | null })
    if (ha !== hb) return ha - hb
    const qa = tipQualityRank((a as { tip?: string | null }).tip)
    const qb = tipQualityRank((b as { tip?: string | null }).tip)
    if (qa !== qb) return qa - qb
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
export function pickPreferredProvider<T extends { name: string; _healthy?: boolean | null }>(list: T[], prefer?: string): T | null {
  if (!list.length) return null
  // ── Never auto-pick a verified-dead server ──
  // A user-pinned preference that points at a dead server would re-trigger
  // the 30s spinner every visit. Prefer a working/unverified match first,
  // and only fall back to the dead one when NOTHING else exists.
  const alive = list.filter((p) => p._healthy !== false)
  const pool = alive.length > 0 ? alive : list
  if (prefer && prefer !== 'auto') {
    const lower = prefer.toLowerCase()
    // 1. Exact match on full name (e.g. 'miruro-megacloud')
    //    ── but skip verified-dead servers when something else exists ──
    //    The dead-tile fallthrough (4.) below still honors an explicit
    //    user choice, so pinning a grayed-out server keeps working.
    const exactAlive = pool.find(p => p.name.toLowerCase() === lower)
    if (exactAlive) return exactAlive
    // 2. Starts-with match (e.g. prefer='miruro' matches 'miruro-MegaCloud')
    const starts = pool.find(p => p.name.toLowerCase().startsWith(lower))
    if (starts) return starts
    // 3. Match against the cleaned name (strip provider-family prefix like
    //    anidap-/miruro-/saturn-/pahe- → then case-insensitive compare).
    //    This lets users pick a specific server like 'yuki' and match
    //    'anidap-Yuki' or 'miruro-Yuki'.
    const cleanMatch = pool.find(p => {
      const clean = p.name.replace(/^anidap-/i, '').toLowerCase()
      return clean === lower || clean.startsWith(lower)
    })
    if (cleanMatch) return cleanMatch
    // 4. The preferred server is verified-dead for this title — fall back to
    //    the best ALIVE server instead of looping the 30s spinner forever.
    const sorted = sortProviders(pool)
    return sorted[0] || null
  }
  const sorted = sortProviders(pool)
  return sorted[0] || null
}
