// Which top-level AniZip mapping keys cost bytes (episodes excluded).
const MAL = process.argv[2] || '21'
const r = await fetch(`https://api.ani.zip/mappings?mal_id=${MAL}`)
const j = await r.json()
const sizes = Object.entries(j).map(([k, v]) => [k, JSON.stringify(v)?.length || 0])
const total = sizes.reduce((a, b) => a + b[1], 0)
console.log(`mal ${MAL} — total ${(total / 1024).toFixed(0)}KB`)
for (const [k, n] of sizes.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)} ${(n / 1024).toFixed(1).padStart(8)}KB  ${((n / total) * 100).toFixed(1)}%`)
}
if (j.titles) console.log('titles langs:', Object.keys(j.titles).join(', '))
if (j.images) console.log('images keys:', Object.keys(j.images).join(', '), '| langs:', Object.keys(j.images?.[Object.keys(j.images)[0]] || {}).join(', '))
console.log('tvdbShowId:', j.tvdbShowId, 'episodeCount:', j.episodeCount)
