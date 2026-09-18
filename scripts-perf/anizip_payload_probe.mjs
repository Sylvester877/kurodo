// AniZip mapping payload anatomy — which per-episode fields make a mapping
// 1MB+ (One Piece), and what a lean episode-list shape would cost.
const MAL = process.argv[2] || '21'
const url = `https://api.ani.zip/mappings?mal_id=${MAL}`
const t0 = Date.now()
const r = await fetch(url)
const buf = await r.arrayBuffer()
const json = JSON.parse(Buffer.from(buf).toString('utf8'))
const eps = Object.values(json.episodes || {})
console.log(`mal ${MAL}: ${r.status} ${(buf.byteLength / 1024).toFixed(0)}KB in ${Date.now() - t0}ms, ${eps.length} episodes`)

// Per-key contribution across all episodes
const keyBytes = new Map()
for (const e of eps) {
  for (const [k, v] of Object.entries(e)) {
    const n = JSON.stringify(v)?.length || 0
    keyBytes.set(k, (keyBytes.get(k) || 0) + n)
  }
}
const total = [...keyBytes.values()].reduce((a, b) => a + b, 0)
console.log(`\nper-episode field share of ${(total / 1024).toFixed(0)}KB of episode data:`)
for (const [k, n] of [...keyBytes.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(24)} ${(n / 1024).toFixed(1).padStart(7)}KB  ${((n / total) * 100).toFixed(1)}%`)
}
console.log('\ntop-level keys:', Object.keys(json).join(', '))
console.log('sample episode:', JSON.stringify(eps[0]).slice(0, 400))
console.log('mappings:', JSON.stringify(json.mappings).slice(0, 300))
