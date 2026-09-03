// Verify the adult-content filter end-to-end against the live server.
// 1. Anime search "hentai" + "henata" (typo) + a normal query — no NSFW genres.
// 2. MangaDex browse/search — no erotica/pornographic content ratings.
// 3. Atsu search — no hentai-labeled titles.
const BASE = 'http://localhost:5173'
const NSFW = new Set(['Hentai', 'Erotica'])

async function getJson(url) {
  const r = await fetch(url)
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { __html: t.slice(0, 80) } }
}

let failures = 0

// ── 1. Anime search (Jikan/AniList race happens client-side in the app;
//       here we test the Jikan proxied path the app uses) ──
for (const q of ['hentai', 'henata', 'hetnai', 'necopara', 'one piece']) {
  const j = await getJson(`${BASE}/api/jikan/anime?q=${encodeURIComponent(q)}&sfw=true&limit=24`)
  const results = j.data || []
  const bad = results.filter((m) => (m.genres || []).some((g) => NSFW.has(g.name)))
  const verdict = bad.length === 0 ? 'CLEAN' : `LEAKED ${bad.length}`
  if (bad.length) failures++
  console.log(`anime jikan "${q}": ${results.length} results → ${verdict}`)
}

// ── 2. MangaDex browse + search via our backend ──
for (const [label, url] of [
  ['mangadex browse', `${BASE}/api/manga/browse?sort=popular&limit=32`],
  ['mangadex search "hentai"', `${BASE}/api/manga/search?q=hentai&limit=24`],
]) {
  const j = await getJson(url)
  const results = j.data?.results || j.results || []
  const bad = results.filter((m) => m.contentRating === 'erotica' || m.contentRating === 'pornographic')
  const verdict = bad.length === 0 ? 'CLEAN' : `LEAKED ${bad.length} (${bad.slice(0, 3).map((m) => m.title).join(', ')})`
  if (bad.length) failures++
  console.log(`${label}: ${results.length} results → ${verdict}`)
}

// ── 3. Atsu search ──
{
  const j = await getJson(`${BASE}/api/atsu/search?q=hentai&limit=24`)
  const results = j.data?.results || j.results || []
  const HENTAI_RE = /\bhentai\b|pornograph/i
  const bad = results.filter((m) => HENTAI_RE.test(`${m.title || ''} ${m.englishTitle || ''}`))
  const verdict = bad.length === 0 ? 'CLEAN' : `LEAKED ${bad.length}`
  if (bad.length) failures++
  console.log(`atsu search "hentai": ${results.length} results → ${verdict}`)
}

console.log(failures === 0 ? '\nNSFW FILTER: ALL CLEAN ✓' : `\nNSFW FILTER: ${failures} LEAK(S)`)
process.exit(failures === 0 ? 0 : 1)
