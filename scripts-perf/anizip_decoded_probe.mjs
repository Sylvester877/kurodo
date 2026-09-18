// Decoded payload sizes (bytes AFTER gunzip — what the renderer actually
// parses and structured-clones). Curl's size_download counts compressed bytes,
// which hid the real win of the mapping slimming.
const ORIGIN = process.argv[2] || 'http://localhost:5173'
const IDS = [21, 269, 52991, 57555]

async function size(url) {
  const t0 = Date.now()
  const r = await fetch(ORIGIN + url)
  const buf = Buffer.from(await r.arrayBuffer())
  return { kb: Math.round(buf.byteLength / 1024), ms: Date.now() - t0, status: r.status }
}

for (const id of IDS) {
  const m = await size(`/api/anizip/mapping?mal_id=${id}`)
  const a = await size(`/api/anikage-episodes/${id}`)
  console.log(`mal ${String(id).padEnd(6)} mapping ${String(m.kb).padStart(6)}KB ${String(m.ms).padStart(6)}ms   anikage-episodes ${String(a.kb).padStart(6)}KB ${String(a.ms).padStart(6)}ms   total ${m.kb + a.kb}KB`)
}
