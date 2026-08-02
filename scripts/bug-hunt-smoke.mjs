// Bug-hunt smoke battery for the packaged Kurodo app (v0.3.10)
// Exercises the exact endpoints the UI calls, with timing.
const BASE = 'http://localhost:5173';
const log = (label, pass, extra = '') =>
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${label}${extra ? ' | ' + extra : ''}`);

async function getJSON(path, timeoutMs = 25000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(BASE + path, { signal: ctl.signal });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 120) }; }
    return { status: r.status, j, ms: 0 };
  } catch (e) {
    return { status: 0, j: { error: String(e).slice(0, 120) }, ms: 0 };
  } finally {
    clearTimeout(t);
  }
}

const t0 = Date.now();
const timer = () => Date.now() - t0;

// 1. SEARCH
const search = await getJSON('/api/jikan/anime?q=bleach&limit=3', 15000);
const searchItems = Array.isArray(search.j.data) ? search.j.data : [];
log('search /api/jikan/anime?q=bleach', search.status === 200 && searchItems.length > 0,
  `status=${search.status} results=${searchItems.length} ${timer()}ms`);
if (searchItems[0]) log('  first title', !!searchItems[0].title, searchItems[0].title);

// 2. INFO
const info = await getJSON('/api/anidap/info/269?anilistId=269', 20000);
const infoData = info.j.data || {};
log('info /api/anidap/info/269', info.status === 200,
  `status=${info.status} title=${String(infoData.title || infoData.name).slice(0, 40)} ${timer()}ms`);

// 3. EPISODES
const eps = await getJSON('/api/anidap/episodes/269?anilistId=269', 25000);
const epsData = eps.j.data || {};
const epsList = epsData.episodes || [];
const withImg = epsList.filter((e) => e.image).length;
const withThumb = epsList.filter((e) => e.thumbnail || e.thumb).length;
log('episodes /api/anidap/episodes/269', eps.status === 200 && epsList.length > 0,
  `status=${eps.status} total=${epsData.total ?? epsList.length} withImage=${withImg} ${timer()}ms`);

// 4. SERVERS
const srv = await getJSON('/api/anidap/servers/269/1?anilistId=269', 25000);
const srvData = srv.j.data || {};
const provs = srvData.providers || [];
log('servers ep1', srv.status === 200 && provs.length > 0,
  `status=${srv.status} providers=${provs.map((p) => p.name).join(',')} ${timer()}ms`);

// 5. STREAMS — test first 4 sub providers, timing each
const subProvs = (provs.filter((p) => p.name && !/gogo/.test(p.name))).slice(0, 4).map((p) => p.name);
log('stream-providers selected', subProvs.length > 0, subProvs.join(','));
for (const p of subProvs.slice(0, 3)) {
  const ts = timer();
  const src = await getJSON(`/api/anidap/sources/269/1/${p}/sub?anilistId=269`, 30000);
  const d = src.j.data || {};
  const url = d.proxiedUrl || d.url || '';
  log(`stream ${p}`, src.status === 200 && !!url, `status=${src.status} ms=${timer() - ts} url=${url.slice(0, 70)}`);
}

// 6. /img proxy (real image bytes)
const img = await fetch(BASE + '/img?url=https%3A%2F%2Fs4.anilist.co%2Ffile%2Fanilistcdn%2Fmedia%2Fanime%2Fcover%2Flarge%2Fbx269-d2GmRkJbMopq.png', { signal: AbortSignal.timeout(20000) });
const imgBuf = Buffer.from(await img.arrayBuffer());
const ct = img.headers.get('content-type') || '';
log('/img proxy', img.status === 200 && !ct.includes('svg'), `status=${img.status} type=${ct} size=${imgBuf.length}`);

// 7. /proxy HLS through packaged server
const m3u8Url = encodeURIComponent('https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8');
const hls = await fetch(BASE + '/proxy?url=' + m3u8Url, { signal: AbortSignal.timeout(20000) });
const hlsTxt = await hls.text();
log('/proxy m3u8', hls.status === 200 && hlsTxt.includes('#EXTM3U'), `status=${hls.status} bytes=${hlsTxt.length} head=${hlsTxt.slice(0, 40).replace(/\n/g, ' ')}`);

console.log(`\nTOTAL ${timer()}ms`);
