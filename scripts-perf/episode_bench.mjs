// Episode-chain benchmark: what the details/watch pages actually wait on.
//   /api/anizip/mapping        — episode metadata (AniZip)
//   /api/anikage-episodes/:id  — enriched list (TVDB images + titles + filler)
//   /api/episode-thumbs/:id    — TVDB/TMDB thumbnail map
//   /api/tvdb-episodes/:id     — TVDB raw (when present)
//   /api/jikan/anime/:id/episodes — MAL episode metadata
// Usage: node scripts-perf/episode_bench.mjs [origin] [passes]
const ORIGIN = process.argv[2] || 'http://localhost:5173'
const PASSES = Number(process.argv[3] || 2)
const MAL_IDS = [
  [21, 'One Piece (1100+ eps)'],
  [269, 'Bleach (366 eps)'],
  [52991, 'Frieren (28 eps)'],
  [57555, 'Chainsaw Man Reze (movie)'],
]

async function t(url) {
  const s = Date.now()
  try {
    const r = await fetch(ORIGIN + url, { signal: AbortSignal.timeout(60000) })
    const json = await r.json().catch(() => null)
    let note = ''
    if (json?.data?.episodes) note = `${json.data.episodes.length} eps`
    else if (json?.data?.eps) note = `${Object.keys(json.data.eps).length} thumbs`
    else if (json?.data?.episodes && typeof json.data.episodes === 'object') note = `${Object.keys(json.data.episodes).length} eps`
    else if (json?.eps) note = `${Object.keys(json.eps).length} thumbs`
    else if (json?.data?.length) note = `${json.data.length} rows`
    else if (json?.data && typeof json.data === 'object') note = `${Object.keys(json.data).length} keys`
    else if (json?.error) note = String(json.message || json.error).slice(0, 40)
    return { status: r.status, ms: Date.now() - s, note }
  } catch (e) {
    return { status: 'ERR:' + e.name, ms: Date.now() - s, note: '' }
  }
}

const line = (label, r) =>
  console.log(`  ${label.padEnd(42)} ${String(r.status).padEnd(6)} ${(r.ms / 1000).toFixed(2).padStart(6)}s  ${r.note}`)

console.log('═ EPISODE CHAIN BENCH ═', ORIGIN)
for (let pass = 1; pass <= PASSES; pass++) {
  console.log(`\n── pass ${pass} ${pass === 1 ? '(cold)' : '(warm)'} ──`)
  for (const [malId, name] of MAL_IDS) {
    console.log(`  · ${name}  (mal ${malId})`)
    line(`anikage-episodes/${malId}`, await t(`/api/anikage-episodes/${malId}`))
    line(`anizip/mapping?mal_id=${malId}`, await t(`/api/anizip/mapping?mal_id=${malId}`))
    line(`episode-thumbs/${malId}`, await t(`/api/episode-thumbs/${malId}`))
    line(`jikan episodes ${malId} p1`, await t(`/api/jikan/anime/${malId}/episodes?page=1`))
  }
}
console.log('\nbench done')
