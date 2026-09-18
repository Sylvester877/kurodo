export interface ProviderMeta {
  name: string; label: string; hint?: string; priority: number; recommended?: boolean
}
export const PROVIDER_META: Record<string, ProviderMeta> = {
  // ── Current chad roster (Aug 2026 re-shuffle) ──
  // The legacy multi-1080p fleet (nuri/kami/koto/mochi/vee/yume/uwu) is
  // GONE upstream — chad now serves sora/kiwi/neko/beep/mimi/yuki (verified
  // live: sora/kiwi/neko/beep masters carry a 1920x1080 variant).
  // NOTE: the renderer no longer hardcodes this for new servers — the
  // server API now sends fresh `tip` strings from chad, and Unknown
  // servers (no entry here) get a neutral auto-derived label instead of a
  // stale one.
  //
  // ── PRIORITY IS MEASURED CAPABILITY, NOT PICTURE QUALITY (Sep 2026) ──
  // This table used to rank by quality (sora/kiwi/neko 0, mimi 2, yuki 3),
  // which is exactly backwards for a default pick: `mimi` ranked 2 while
  // being **8%** on dub, and `loli` — the single best server measured — was
  // not in the table at all (no entry → priority 8 → tried LAST). Per-chip
  // scores from dub_bench.mjs (100 titles, pick=1) and servers_bench.mjs
  // (20 obscure titles):
  //   dub/sub:  loli 92/80 · yuki 70/29 · neko 68/35 · sora 58/21
  //             miku 13 · mimi 8 · kiwi 8/8 · beep 8 · legacy 8
  // A 720p stream that plays beats a 1080p chip that 404s, so capability now
  // leads and the upstream `tip` quality only breaks ties between UNKNOWN
  // servers (all priority 8) — see sortProviders.
  loli:   { name: 'loli',   label: 'Loli',     hint: 'Multi quality',                      priority: 0, recommended: true },
  yuki:   { name: 'yuki',   label: 'Yuki',     hint: 'Soft sub, Good, Multi quality',      priority: 1 },
  neko:   { name: 'neko',   label: 'Neko',     hint: 'Hard sub, Fast, High quality',       priority: 2 },
  sora:   { name: 'sora',   label: 'Sora',     hint: 'Soft sub, Fast, High quality',       priority: 3 },
  miku:   { name: 'miku',   label: 'Miku',     hint: 'Legacy',                             priority: 4 },
  mimi:   { name: 'mimi',   label: 'Mimi',     hint: 'Soft sub, Fastest',                  priority: 5 },
  kiwi:   { name: 'kiwi',   label: 'Kiwi',     hint: 'Hard sub, Fast, High quality',       priority: 6 },
  beep:   { name: 'beep',   label: 'Beep',     hint: 'Soft sub, Fast',                     priority: 7 },
  // ── Legacy names, kept in case upstream revives them ──
  nuri:   { name: 'nuri',   label: 'Nuri',     hint: 'Legacy',                             priority: 9 },
  kami:   { name: 'kami',   label: 'Kami',     hint: 'Legacy',                             priority: 9 },
  koto:   { name: 'koto',   label: 'Koto',     hint: 'Legacy',                             priority: 9 },
  mochi:  { name: 'mochi',  label: 'Mochi',    hint: 'Legacy',                             priority: 9 },
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
  //   1. static PROVIDER_META priority — measured per-chip capability
  //   2. tip quality ("High quality" first) — tie-breaker for UNKNOWN
  //      servers only, since every known server has a distinct priority
  //   3. chad's per-episode `default` flag
  //   4. alphabetic name — makes the order deterministic across reloads
  //      (V8's sort is not guaranteed stable; without the tie-breaker two
  //      servers sharing all keys would "shuffle" on every page load).
  //
  // fixes: "success 100%, fail 0%" default selection. Quality used to lead
  // capability, so the DEFAULT pick (and therefore the first thing the
  // auto-failover chain tried) was the best-LOOKING chip rather than the most
  // likely to actually have the episode. Verified health still outranks both,
  // so a live probe always wins the pick.
  return [...list].sort((a, b) => {
    const ha = healthRank(a as T & { _healthy?: boolean | null })
    const hb = healthRank(b as T & { _healthy?: boolean | null })
    if (ha !== hb) return ha - hb
    const pa = getProviderMeta(a.name).priority
    const pb = getProviderMeta(b.name).priority
    if (pa !== pb) return pa - pb
    const qa = tipQualityRank((a as { tip?: string | null }).tip)
    const qb = tipQualityRank((b as { tip?: string | null }).tip)
    if (qa !== qb) return qa - qb
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
