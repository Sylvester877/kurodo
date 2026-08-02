import axios from 'axios'

const HDR = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  accept: 'application/json, */*',
  referer: 'https://anidap.se/',
  origin: 'https://anidap.se',
}

const tests = [
  { name: 'One Piece', anilist: 21 },
  { name: 'Demon Slayer', anilist: 101922 },
  { name: 'Frieren', anilist: 154587 },
  { name: 'Naruto', anilist: 20 },
]

for (const t of tests) {
  console.log(`\n=== ${t.name} (${t.anilist}) ===`)
  try {
    const { data: info } = await axios.get(`https://anidap.se/info/${t.anilist}.data`, { headers: HDR, timeout: 10000 })
    let slug = null
    if (Array.isArray(info)) {
      for (let i = 0; i < info.length - 1; i++) {
        if (info[i] === 'id' && typeof info[i+1] === 'string' && /^[a-z0-9][a-z0-9-]+-[a-z0-9]{4,6}$/i.test(info[i+1])) {
          slug = info[i+1]; break
        }
      }
    }
    console.log('slug:', slug)
    if (!slug) continue

    const { data: srv } = await axios.get(`https://chad.anidap.se/rest/api/servers?id=${encodeURIComponent(slug)}&epNum=1`, { headers: HDR, timeout: 10000 })
    console.log('servers:', JSON.stringify(srv).slice(0, 400))

    // Try each sub provider
    const subs = (srv.subProviders || []).map(p => typeof p === 'string' ? p : p.id)
    for (const pid of subs) {
      const t0 = Date.now()
      try {
        const { data: src, status } = await axios.get(
          `https://chad.anidap.se/rest/api/sources?id=${encodeURIComponent(slug)}&epNum=1&type=sub&providerId=${encodeURIComponent(pid)}`,
          { headers: HDR, timeout: 15000, validateStatus: () => true }
        )
        const url = src?.sources?.[0]?.url
        const ms = Date.now() - t0
        if (status >= 400 || !url) {
          console.log(`  ✗ ${pid.padEnd(10)} ${ms}ms HTTP ${status} ${JSON.stringify(src).slice(0,120)}`)
          continue
        }
        // Probe the m3u8
        const refer = src?.headers?.Referer || src?.headers?.referer || 'https://anidap.se/'
        const origin = src?.headers?.Origin || src?.headers?.origin || new URL(url).origin
        const m3hdr = { ...HDR, referer: refer, origin }
        if (src?.headers?.['User-Agent']) m3hdr['user-agent'] = src.headers['User-Agent']
        const t1 = Date.now()
        try {
          const r = await axios.get(url, { headers: m3hdr, timeout: 10000, validateStatus: () => true, responseType: 'text' })
          const ms2 = Date.now() - t1
          const ok = r.status === 200 && String(r.data).includes('#EXTM3U')
          console.log(`  ${ok ? '✓' : '✗'} ${pid.padEnd(10)} ${ms}+${ms2}ms m3u8 HTTP ${r.status} ${ok ? 'OK' : (String(r.data).slice(0,80))}`)
        } catch (e) {
          console.log(`  ✗ ${pid.padEnd(10)} ${ms}+${Date.now()-t1}ms m3u8 ERR ${e.code || e.message}`)
        }
      } catch (e) {
        console.log(`  ✗ ${pid.padEnd(10)} src ERR ${e.code || e.message}`)
      }
    }
  } catch (e) {
    console.log('  FAIL:', e.message)
  }
}
