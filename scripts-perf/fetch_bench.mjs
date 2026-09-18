// Fetch-time benchmark — measures the real chains the app hits, on both
// warm (cached) and cold paths where feasible. Reports status + latency.
// Usage: node scripts-perf/fetch_bench.mjs [origin]
const ORIGIN = process.argv[2] || 'http://127.0.0.1:5199'

const t = async (label, url, opts = {}) => {
  const s = Date.now()
  let status = 'ERR'
  try {
    const r = await fetch(ORIGIN + url, { signal: AbortSignal.timeout(opts.timeout || 25000), ...opts })
    status = r.status
    if (opts.expectJson !== false) {
      const j = await r.json().catch(() => null)
      if (opts.summary) return { status, ms: Date.now() - s, summary: opts.summary(j) }
    }
  } catch (e) { status = 'ERR:' + e.name }
  return { status, ms: Date.now() - s, summary: '' }
}

const fmt = (r, label) => {
  const pad = label.padEnd(46)
  const extra = r.summary ? '  [' + r.summary + ']' : ''
  console.log(`  ${pad} ${String(r.status).padEnd(6)} ${(r.ms / 1000).toFixed(2).padStart(6)}s${extra}`)
}

console.log('═ KURŌDO FETCH BENCHMARK ═')
console.log('origin:', ORIGIN)
console.log()

// ── 1. Server basics ──
console.log('── 1. Server basics ──')
fmt(await t('health', '/api/health'), 'GET /api/health')

// ── 2. Home feed (AniList GQL via relay) ──
console.log('── 2. Home feed rows (AniList relay) ──')
const feedQuery = (sort) => `query ($p:Int){Page(page:1,perPage:$p){media(type:ANIME,${sort}){id idMal title{romaji english} coverImage{extraLarge} bannerImage episodes averageScore}}}`

const feeds = [
  ['trending', 'sort: TRENDING_DESC, status_in: [RELEASING, FINISHED]'],
  ['season', 'status: RELEASING, sort: POPULARITY_DESC'],
  ['most-favorite', 'sort: SCORE_DESC, status_in: [FINISHED, RELEASING]'],
  ['upcoming', 'status: NOT_YET_RELEASED, sort: POPULARITY_DESC'],
]
for (const [name, filter] of feeds) {
  const r1 = await t(`feed:${name}`, '/api/anilist-gql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: feedQuery(filter), variables: { p: 18 } }),
    summary: (j) => (j?.data?.Page?.media?.length ? j.data.Page.media.length + ' items' : JSON.stringify(j?.errors?.[0]?.message || '').slice(0, 40)),
  })
  fmt(r1, `POST /api/anilist-gql  feed:${name}`)
}

// ── 3. Details page chain (uncached title: Cowboy Bebop 1) ──
console.log('── 3. Details page chain ──')
const DETAIL_MAL = 1 // Cowboy Bebop
fmt(await t('jikan anime/:id', `/api/jikan/anime/${DETAIL_MAL}`,
  { summary: (j) => (j?.data?.title ? j.data.title.slice(0, 25) : 'none') }),
'GET /api/jikan/anime/' + DETAIL_MAL)
fmt(await t('epInfo (anilist)', '/api/anilist-gql', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'query ($m:Int){Media(idMal:$m,type:ANIME){id episodes status bannerImage}}', variables: { m: DETAIL_MAL } }),
  summary: (j) => (j?.data?.Media?.id ? 'anilist#' + j.data.Media.id : 'n/a'),
}), 'POST /api/anilist-gql  epInfo')
fmt(await t('anizip mapping', `/api/anizip/mapping?mal_id=${DETAIL_MAL}`,
  { summary: (j) => (j?.data?.episodes ? Object.keys(j.data.episodes).length + ' eps' : 'none') }),
'GET /api/anizip/mapping')
fmt(await t('episode-thumbs', `/api/episode-thumbs/${DETAIL_MAL}`,
  { summary: (j) => (j?.eps ? Object.keys(j.eps).length + ' thumbs' : 'none') }),
'GET /api/episode-thumbs/' + DETAIL_MAL)

// ── 4. Watch page chain (stream) ──
console.log('── 4. Watch chain (anidap) ──')
fmt(await t('servers list', '/api/anidap/servers/1/1?anilistId=1',
  { summary: (j) => (j?.data?.providers?.length ? j.data.providers.length + ' providers' : 'n/a') }),
'GET /api/anidap/servers (Cowboy Bebop ep1)')

// ── 5. Search ──
console.log('── 5. Search ──')
fmt(await t('search q=bleach', '/api/jikan/anime?q=bleach&limit=24&sfw=true',
  { summary: (j) => (j?.data?.length ? j.data.length + ' hits' : 'none') }),
'GET /api/jikan/anime?q=bleach')

// ── 6. Images (proxy first-byte proxy) ──
console.log('── 6. Image proxy ──')
fmt(await t('img proxy', '/img?url=' + encodeURIComponent('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-CXtrrkMpJ8Zq.png'),
  { expectJson: false, summary: () => '' }), 'GET /img (anilist cover)')

// ── 7. Repeat pass = warm-cache timings ──
console.log('── 7. Warm-cache repeats ──')
for (const name of feeds) {
  const r2 = await t(`feed:${name}`, '/api/anilist-gql', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: feedQuery(name[1] || ''), variables: { p: 18 } }),
    expectJson: false,
  })
  if (r2.ms < 1000) fmt(r2, `WARM POST feed:${name[0]}`)
}
fmt(await t('warm jikan anime', `/api/jikan/anime/${DETAIL_MAL}`, { expectJson: false }), 'WARM GET /api/jikan/anime/' + DETAIL_MAL)
fmt(await t('warm servers', '/api/anidap/servers/1/1?anilistId=1', { expectJson: false }), 'WARM GET /api/anidap/servers')
fmt(await t('warm img', '/img?url=' + encodeURIComponent('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1-CXtrrkMpJ8Zq.png'), { expectJson: false }), 'WARM GET /img')

console.log('\nbench done')
